"""Apply the managed account replica and its single route on trusted main."""

import base64
from functools import partial
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from browser_auth_bootstrap import IAM_SERVICE_ACCOUNTS, LOCKBOX, access_bindings
from deploy_browser_auth import (
    VERSIONS, YandexHttpError, function_bindings, function_version_list, request_api, select_tagged_version,
)
from web_hosting import (
    ACCOUNT_REPLICA_PATH, ACCOUNT_REPLICA_TAG, DEXIE_TOKEN_PATH, FUNCTIONS, GATEWAYS, NAME_ACCOUNT_REPLICA_FUNCTION,
    NAME_GATEWAY, OPERATIONS, WebHostingError, NoRedirect, account_replica_route, await_operation, bucket_name,
    checked_gateway_spec, choose, normalize_gateway_readback, paged_list, resource_id, verified_gateway_domains,
)

SITE = "ACCOUNT_REPLICA"
DATABASES = "https://ydb.api.cloud.yandex.net/ydb/v1/databases"
YDB_GRPC = "ydb.api.cloud.yandex.net:443"
NAME = NAME_ACCOUNT_REPLICA_FUNCTION
RUNTIME_NAME = "mezfit-account-replica-runtime"
REGION = "ru-central1"
MANAGED = "Mezfit managed account replica (D1 to YDB)"
FINGERPRINT = "Mezfit account replica SHA256:"
SOURCE = Path(__file__).with_name("account-replica")
FILES = ("index.py", "replica_store.py", "requirements.txt", "schema.yql")
SECRET_ENV = "MEZFIT_ACCOUNT_REPLICATION_SECRET"
SECRET_KEY = "replication_secret"
MEMORY = str(256 * 1024 * 1024)
TIMEOUT = "28s"


def find(api, endpoint, folder, field, name):
    return choose(paged_list(api, endpoint, folder, field, f"List {field}"), name, folder, name)


def ensure(api, endpoint, folder, field, name, **config):
    resource = find(api, endpoint, folder, field, name)
    if not resource:
        label = f"Create {name}"
        result = await_operation(api, api(endpoint, label, {
            "folderId": folder, "name": name, "description": MANAGED, **config,
        }), label)
        resource = find(api, endpoint, folder, field, name)
        if not resource or resource.get("id") != result.get("id"):
            raise WebHostingError(f"{name}: creation failed readback.")
    if not resource_id(resource.get("id")) or resource.get("description") != MANAGED:
        raise WebHostingError(f"{name}: unexpected existing resource; inspect ownership.")
    return resource


def database_config(database):
    endpoint = database.get("endpoint")
    url = urlsplit(endpoint) if isinstance(endpoint, str) else urlsplit("")
    match = re.fullmatch(r"database=(/ru-central1/[a-z0-9]+/[a-z0-9]+)", url.query)
    options = database.get("serverlessDatabase")
    if (database.get("status") != "RUNNING" or database.get("locationId") != REGION
            or not isinstance(options, dict) or database.get("deletionProtection") is not True
            or options.get("storageSizeLimit") != str(1024**3)
            or options.get("enableThrottlingRcuLimit") not in (None, False)
            or options.get("provisionedRcuLimit") not in (None, "0", 0)
            or url.scheme != "grpcs" or url.netloc != "ydb.serverless.yandexcloud.net:2135"
            or url.path not in ("", "/") or url.fragment or not match
            or match[1].rsplit("/", 1)[-1] != database["id"]):
        raise WebHostingError("Account replica YDB differs from the approved serverless database configuration.")
    return f"{url.scheme}://{url.netloc}", match[1]


def wait_database(api, database):
    for _ in range(40):
        if database.get("status") not in {"PROVISIONING", "STARTING"}:
            return database
        time.sleep(3)
        current = api(f"{DATABASES}/{database['id']}", "Read account replica YDB readiness")
        if any(current.get(key) != database.get(key) for key in ("id", "name", "folderId", "description")):
            raise WebHostingError("Account replica YDB identity changed.")
        database = current
    raise WebHostingError("Account replica YDB did not become ready.")


def pinned_secret(secret):
    version = secret.get("currentVersion")
    if (secret.get("status") != "ACTIVE" or secret.get("deletionProtection") is not True
            or not isinstance(version, dict) or version.get("secretId") != secret["id"]
            or not resource_id(version.get("id")) or version.get("status") != "ACTIVE"
            or version.get("payloadEntryKeys") != [SECRET_KEY]):
        raise WebHostingError("Account replica Lockbox version or keys differ from the expected configuration.")
    return [{"id": secret["id"], "versionId": version["id"], "key": SECRET_KEY,
             "environmentVariable": SECRET_ENV}]


def binding(role, account):
    return {"roleId": role, "subject": {"type": "serviceAccount", "id": account}}


def ensure_binding(api, endpoint, observe, wanted, label):
    before = observe()
    if before == [wanted]:
        return
    if before:
        raise WebHostingError(f"{label}: unexpected access bindings.")
    if observe():
        raise WebHostingError(f"{label}: access bindings changed concurrently.")
    await_operation(api, api(endpoint, label, {
        "accessBindingDeltas": [{"action": "ADD", "accessBinding": wanted}],
    }), label)
    if observe() != [wanted]:
        raise WebHostingError(f"{label}: access bindings failed readback.")


def ensure_ydb_binding(api, database_id, runtime_id, token):
    # The YDB management API exposes access-binding methods over gRPC.
    import grpc
    from yandex.cloud.access.access_pb2 import ADD, ListAccessBindingsRequest, UpdateAccessBindingsRequest
    from yandex.cloud.ydb.v1.database_service_pb2_grpc import DatabaseServiceStub

    credentials = grpc.composite_channel_credentials(
        grpc.ssl_channel_credentials(), grpc.access_token_call_credentials(token))
    try:
        with grpc.secure_channel(YDB_GRPC, credentials) as channel:
            client = DatabaseServiceStub(channel)

            def inspect():
                result = client.ListAccessBindings(
                    ListAccessBindingsRequest(resource_id=database_id, page_size=1000), timeout=20)
                if result.next_page_token:
                    raise WebHostingError("Unexpected quantity of YDB access bindings.")
                return [(item.role_id, item.subject.type, item.subject.id) for item in result.access_bindings]

            expected = [("ydb.editor", "serviceAccount", runtime_id)]
            current = inspect()
            if current == expected:
                return
            if current or inspect():
                raise WebHostingError("YDB account replica has unexpected access bindings.")
            request = UpdateAccessBindingsRequest(resource_id=database_id)
            delta = request.access_binding_deltas.add(action=ADD)
            delta.access_binding.role_id = "ydb.editor"
            delta.access_binding.subject.type = "serviceAccount"
            delta.access_binding.subject.id = runtime_id
            operation = client.UpdateAccessBindings(request, timeout=20)
            if operation.done:
                if operation.HasField("error"):
                    raise WebHostingError("YDB access binding operation failed.")
            else:
                if not resource_id(operation.id):
                    raise WebHostingError("YDB access binding operation has no valid ID.")
                url = f"{OPERATIONS}/{operation.id}"
                await_operation(api, api(url, "Read YDB access binding operation"),
                                "Grant the runtime access to the replica YDB")
            if inspect() != expected:
                raise WebHostingError("YDB account replica access bindings failed readback.")
    except grpc.RpcError as exc:
        raise WebHostingError(f"YDB account replica access bindings: gRPC {exc.code().name}.") from None


def package():
    archive = io.BytesIO()
    with ZipFile(archive, "w", ZIP_DEFLATED) as writer:
        for name in FILES:
            item = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = ZIP_DEFLATED
            item.external_attr = 0o644 << 16
            writer.writestr(item, (SOURCE / name).read_bytes())
    content = archive.getvalue()
    return content, hashlib.sha256(content).hexdigest()


def ensure_version(api, function_id, runtime_id, environment, secrets):
    contents, digest = package()
    fingerprint = FINGERPRINT + digest
    candidate_tag = "account-" + digest[:24]

    def versions():
        return function_version_list(api, function_id)

    def verify(version):
        if (not resource_id(version.get("id")) or version.get("functionId") != function_id
                or version.get("status") != "ACTIVE" or version.get("runtime") != "python312"
                or version.get("entrypoint") != "index.handler" or version.get("serviceAccountId") != runtime_id
                or version.get("environment") != environment or version.get("secrets") != secrets
                or version.get("resources", {}).get("memory") != MEMORY
                or version.get("executionTimeout") != TIMEOUT):
            raise WebHostingError("Account replica function version differs from the approved configuration.")

    before = versions()
    old = select_tagged_version(before, ACCOUNT_REPLICA_TAG)
    if old:
        verify(old)
        if not re.fullmatch(re.escape(FINGERPRINT) + r"[0-9a-f]{64}", old.get("description", "")):
            raise WebHostingError("Unexpected serving account replica version.")
    candidate = select_tagged_version(before, candidate_tag)
    if not candidate:
        label = "Publish private account replica function version"
        result = await_operation(api, api(VERSIONS, label, {
            "functionId": function_id, "runtime": "python312", "entrypoint": "index.handler",
            "resources": {"memory": MEMORY}, "executionTimeout": TIMEOUT, "serviceAccountId": runtime_id,
            "content": base64.b64encode(contents).decode("ascii"), "environment": environment,
            "secrets": secrets, "description": fingerprint, "tag": [candidate_tag],
        }), label)
        candidate = select_tagged_version(versions(), candidate_tag)
        if not candidate or candidate.get("id") != result.get("id"):
            raise WebHostingError("Account replica function version failed readback.")
    verify(candidate)
    if candidate.get("description") != fingerprint:
        raise WebHostingError("Account replica function package differs from the approved revision.")

    url = f"https://functions.yandexcloud.net/{function_id}?tag={candidate_tag}&readiness=1"
    for attempt in range(5):
        try:
            if api(url, "Verify private account replica function and schema") != {"status": "ready"}:
                raise WebHostingError("Account replica function readiness did not match.")
            break
        except YandexHttpError as exc:
            if exc.status != 503 or attempt == 4:
                raise
            time.sleep(3)

    serving = select_tagged_version(versions(), ACCOUNT_REPLICA_TAG)
    if (serving or {}).get("id") != (old or {}).get("id"):
        raise WebHostingError("Serving version changed concurrently.")
    if (old or {}).get("id") != candidate["id"]:
        label = "Activate verified account replica function version"
        await_operation(api, api(f"{VERSIONS}/{candidate['id']}:setTag", label,
                                 {"tag": ACCOUNT_REPLICA_TAG}), label)
    active = select_tagged_version(versions(), ACCOUNT_REPLICA_TAG)
    if not active or active.get("id") != candidate["id"]:
        raise WebHostingError("Serving account replica version failed readback.")
    verify(active)


def gateway_state(api, folder):
    gateway = find(api, GATEWAYS, folder, "apiGateways", NAME_GATEWAY)
    if (not gateway or gateway.get("status") != "ACTIVE" or not isinstance(gateway.get("domain"), str)
            or not re.fullmatch(r"[a-z0-9.]+\.apigw\.yandexcloud\.net", gateway["domain"])):
        raise WebHostingError("Existing active Mezfit Gateway is required.")
    spec = checked_gateway_spec(gateway, folder, bucket_name(folder), api)
    if not {"/auth/session", DEXIE_TOKEN_PATH} <= spec["paths"].keys():
        raise WebHostingError("Gateway must already serve the browser session and Dexie token routes.")
    return gateway, spec


def configure_route(api, patch, folder, gateway, original, route):
    fresh, specification = gateway_state(api, folder)
    if fresh["id"] != gateway["id"] or fresh["domain"] != gateway["domain"] or specification != original:
        raise WebHostingError("Gateway changed concurrently; retry after inspection.")
    if specification["paths"].get(ACCOUNT_REPLICA_PATH) == route:
        return
    domains = verified_gateway_domains(fresh, folder, api)
    specification = normalize_gateway_readback(specification, fresh["domain"], domains)
    specification["paths"][ACCOUNT_REPLICA_PATH] = route
    label = "Add exact POST account replica route"
    await_operation(api, patch(f"{GATEWAYS}/{gateway['id']}", label, {
        "updateMask": "openapiSpec", "openapiSpec": json.dumps(specification, separators=(",", ":")),
    }), label)
    after, readback = gateway_state(api, folder)
    if (after["id"] != gateway["id"] or after["domain"] != gateway["domain"]
            or readback["paths"].get(ACCOUNT_REPLICA_PATH) != route):
        raise WebHostingError("Account replica Gateway route failed readback.")
    # The service may enrich the OpenAPI metadata after an update.
    if (verified_gateway_domains(after, folder, api) != domains
            or normalize_gateway_readback(readback, after["domain"], domains) != specification):
        raise WebHostingError("An existing Gateway route changed during Apply.")


def verify_unsigned_post(opener, gateway, folder, api):
    # Check the same host that receives replication traffic. Bootstrap may run
    # before the custom domain is attached to the gateway.
    domains = verified_gateway_domains(gateway, folder, api)
    domain = "mezfit.online" if "mezfit.online" in domains else gateway["domain"]
    req = Request(f"https://{domain}{ACCOUNT_REPLICA_PATH}", data=b"{}",
                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req, timeout=15):
            pass
    except HTTPError as exc:
        try:
            if exc.code == 401 and json.loads(exc.read(1024)) == {"error": {"code": "UNAUTHORIZED"}}:
                return
        except (OSError, ValueError):
            pass
        raise WebHostingError(f"Unexpected receiver response for unsigned POST: HTTP {exc.code}.") from None
    except (URLError, OSError) as exc:
        cause = exc.reason if isinstance(exc, URLError) else exc
        raise WebHostingError(f"Unsigned replica POST to {domain} failed: {type(cause).__name__}.") from None
    raise WebHostingError("Account replica Gateway did not reject the unsigned POST.")


def main():
    folder = os.environ.get("YC_FOLDER_ID", "")
    deploy_sa = os.environ.get("YC_DEPLOY_SA_ID", "")
    token = os.environ.get("YC_IAM_TOKEN", "")
    if not resource_id(folder) or not resource_id(deploy_sa) or not token:
        raise WebHostingError("Missing Yandex deployment identity.")
    opener = build_opener(NoRedirect())
    request = partial(request_api, opener, token)

    def api(url, label, payload=None):
        return request(url, label, payload)

    def patch(url, label, payload):
        return request(url, label, payload, method="PATCH")

    gateway, baseline = gateway_state(api, folder)
    secret = find(api, LOCKBOX, folder, "secrets", NAME)
    if secret:
        if secret.get("description") != MANAGED or not resource_id(secret.get("id")):
            raise WebHostingError("Unexpected existing account replica Lockbox secret.")
        pinned_secret(secret)
    else:
        value = os.environ.get(SECRET_ENV, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", value):
            raise WebHostingError(f"Set {SECRET_ENV} to a base64url value from secrets.token_urlsafe(32).")
        secret = ensure(api, LOCKBOX, folder, "secrets", NAME, deletionProtection=True, createVersion=True,
                        versionPayloadEntries=[{"key": SECRET_KEY, "textValue": value}])
    secrets = pinned_secret(secret)

    database = ensure(api, DATABASES, folder, "databases", NAME, locationId=REGION,
                      deletionProtection=True, serverlessDatabase={"storageSizeLimit": str(1024**3)})
    endpoint, database_path = database_config(wait_database(api, database))
    runtime = ensure(api, IAM_SERVICE_ACCOUNTS, folder, "serviceAccounts", RUNTIME_NAME)
    runtime_id = runtime["id"]
    if runtime_id == deploy_sa:
        raise WebHostingError("Deployment and runtime identities must differ.")
    ensure_ydb_binding(api, database["id"], runtime_id, token)
    ensure_binding(api, f"{LOCKBOX}/{secret['id']}:updateAccessBindings",
                   lambda: access_bindings(api, secret["id"]),
                   binding("lockbox.payloadViewer", runtime_id), "Grant the runtime access to its Lockbox secret")

    sys.path.insert(0, str(SOURCE))
    import ydb
    from replica_store import connect, verify_schema
    try:
        store = connect(endpoint, database_path, ydb.AccessTokenCredentials(token), timeout=15)
        try:
            verify_schema(store, create=True)
        finally:
            pool, driver, _ = store
            pool.stop()
            driver.stop()
    except Exception:
        raise WebHostingError("Account replica table creation or schema readback failed; check YDB deploy permissions.") from None

    function = ensure(api, FUNCTIONS, folder, "functions", NAME)
    if function.get("status") != "ACTIVE":
        raise WebHostingError("Account replica function is not active.")
    function_id = function["id"]
    ensure_binding(api, f"{FUNCTIONS}/{function_id}:updateAccessBindings",
                   lambda: function_bindings(api, function_id),
                   binding("functions.functionInvoker", deploy_sa), "Grant the Gateway private function invocation")
    ensure_version(api, function_id, runtime_id, {"YDB_ENDPOINT": endpoint, "YDB_DATABASE": database_path}, secrets)
    if function_bindings(api, function_id) != [binding("functions.functionInvoker", deploy_sa)]:
        raise WebHostingError("Function invocation bindings changed before Gateway activation.")
    current_secret = find(api, LOCKBOX, folder, "secrets", NAME)
    if not current_secret or pinned_secret(current_secret) != secrets:
        raise WebHostingError("Pinned Lockbox version changed before Gateway activation.")
    configure_route(api, patch, folder, gateway, baseline, account_replica_route(function_id, deploy_sa))
    gateway, _ = gateway_state(api, folder)
    verify_unsigned_post(opener, gateway, folder, api)
    print("Account replica: schema and private runtime ready; exact Gateway POST verified (401 without caller secret).")


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(f"{SITE}: unexpected deployment failure.", file=sys.stderr)
        sys.exit(1)
