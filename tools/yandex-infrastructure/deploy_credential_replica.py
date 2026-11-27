"""Manually provision the isolated credential receiver. No Gateway or data writes."""

import base64
from functools import partial
import hashlib
import io
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from browser_auth_bootstrap import IAM_SERVICE_ACCOUNTS, LOCKBOX, access_bindings
from deploy_account_replica import DATABASES, database_config, ensure_binding, ensure_ydb_binding, find, wait_database
from deploy_browser_auth import (
    VERSIONS, YandexHttpError, function_bindings, function_version_list, request_api, select_tagged_version,
)
from web_hosting import FUNCTIONS, NoRedirect, WebHostingError, await_operation, resource_id

NAME = "mezfit-credential-replica"
RUNTIME = NAME + "-runtime"
MANAGED = "Mezfit isolated credential replica (D1 to YDB)"
SOURCE = Path(__file__).with_name("credential-replica")
FILES = ("credential_receiver.py", "credential_store.py", "requirements.txt", "schema.yql")
SECRET_ENV = "MEZFIT_CREDENTIAL_REPLICATION_SECRET"
SECRET_KEY = "replication_secret"
TAG = "credential"
MEMORY = str(256 * 1024 * 1024)
TIMEOUT = "25s"
RESOURCES = (
    (LOCKBOX, "secrets", NAME),
    (DATABASES, "databases", NAME),
    (IAM_SERVICE_ACCOUNTS, "serviceAccounts", RUNTIME),
    (FUNCTIONS, "functions", NAME),
)


def binding(role, service_account):
    return {"roleId": role, "subject": {"type": "serviceAccount", "id": service_account}}


def find_managed(api, folder, entry):
    endpoint, field, name = entry
    resource = find(api, endpoint, folder, field, name)
    if resource and (resource.get("description") != MANAGED or not resource_id(resource.get("id"))):
        raise WebHostingError(f"{field}: existing resource does not match the managed identity.")
    return resource


def ensure(api, folder, entry, **config):
    endpoint, field, name = entry
    current = find_managed(api, folder, entry)
    if current:
        return current
    label = f"Create isolated credential {field}"
    result = await_operation(api, api(endpoint, label, {
        "folderId": folder, "name": name, "description": MANAGED, **config,
    }), label)
    created = find_managed(api, folder, entry)
    if not created or created["id"] != result.get("id"):
        raise WebHostingError(f"{field}: creation failed readback.")
    return created


def pinned_secret(secret):
    version = secret.get("currentVersion", {})
    if (secret.get("status") != "ACTIVE" or secret.get("deletionProtection") is not True
            or not isinstance(version, dict) or version.get("secretId") != secret["id"]
            or not resource_id(version.get("id")) or version.get("status") != "ACTIVE"
            or version.get("payloadEntryKeys") != [SECRET_KEY]):
        raise WebHostingError("Credential Lockbox pin or payload schema differs.")
    return [{"id": secret["id"], "versionId": version["id"], "key": SECRET_KEY,
             "environmentVariable": SECRET_ENV}]


def check_existing(api, folder, deploy_sa):
    secret, database, runtime, function = resources = [find_managed(api, folder, entry) for entry in RESOURCES]
    if runtime and runtime["id"] == deploy_sa:
        raise WebHostingError("Credential runtime and deployer must be distinct.")
    if secret:
        pinned_secret(secret)
        viewers = access_bindings(api, secret["id"])
        if viewers and (not runtime or viewers != [binding("lockbox.payloadViewer", runtime["id"])]):
            raise WebHostingError("Unexpected credential Lockbox access bindings.")
    if database and database.get("status") == "RUNNING":
        database_config(database)
    if function:
        invokers = function_bindings(api, function["id"])
        if invokers and invokers != [binding("functions.functionInvoker", deploy_sa)]:
            raise WebHostingError("Unexpected credential function invokers.")
    return resources


def package():
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for name in FILES:
            member = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            member.compress_type = ZIP_DEFLATED
            member.external_attr = 0o644 << 16
            archive.writestr(member, (SOURCE / name).read_bytes())
    contents = buffer.getvalue()
    return base64.b64encode(contents).decode("ascii"), hashlib.sha256(contents).hexdigest()


def publish(api, function_id, runtime_id, endpoint, database, secrets):
    content, digest = package()
    config = {
        "functionId": function_id, "runtime": "python312", "entrypoint": "credential_receiver.handler",
        "resources": {"memory": MEMORY}, "executionTimeout": TIMEOUT, "serviceAccountId": runtime_id,
        "environment": {"YDB_ENDPOINT": endpoint, "YDB_DATABASE": database}, "secrets": secrets,
        "description": "Mezfit credential replica SHA256:" + digest,
    }
    candidate_tag = "cred-" + digest[:24]

    def versions():
        return function_version_list(api, function_id)

    def verify(version):
        if (not version or not resource_id(version.get("id")) or version.get("status") != "ACTIVE"
                or any(version.get(key) != value for key, value in config.items())):
            raise WebHostingError("Credential version does not match its reviewed package and runtime configuration.")

    existing = versions()
    serving = select_tagged_version(existing, TAG)
    if serving and not re.fullmatch(r"Mezfit credential replica SHA256:[0-9a-f]{64}", serving.get("description", "")):
        raise WebHostingError("Unexpected serving credential version.")
    candidate = select_tagged_version(existing, candidate_tag)
    if not candidate:
        label = "Publish candidate credential function"
        created = await_operation(api, api(VERSIONS, label, config | {
            "content": content, "tag": [candidate_tag],
        }), label)
        candidate = select_tagged_version(versions(), candidate_tag)
        if not candidate or candidate.get("id") != created.get("id"):
            raise WebHostingError("Credential candidate version failed readback.")
    verify(candidate)

    url = f"https://functions.yandexcloud.net/{function_id}?tag={candidate_tag}&readiness=1"
    for attempt in range(5):
        try:
            if api(url, "Verify credential runtime and YDB schema") != {"status": "ready"}:
                raise WebHostingError("Invalid credential readiness response.")
            break
        except YandexHttpError as exc:
            if exc.status != 503 or attempt == 4:
                raise
            time.sleep(3)

    verify_post_requires_secret(api, function_id, candidate_tag)
    current = select_tagged_version(versions(), TAG)
    if (current or {}).get("id") != (serving or {}).get("id"):
        raise WebHostingError("Credential serving tag changed during deployment.")
    if (current or {}).get("id") != candidate["id"]:
        label = "Activate verified private credential version"
        await_operation(api, api(f"{VERSIONS}/{candidate['id']}:setTag", label, {"tag": TAG}), label)
    final = select_tagged_version(versions(), TAG)
    verify(final)
    if final["id"] != candidate["id"]:
        raise WebHostingError("Credential serving tag failed readback.")


def verify_post_requires_secret(api, function_id, tag):
    url = f"https://functions.yandexcloud.net/{function_id}?tag={tag}"
    try:
        # The IAM token permits invocation. It must not authorize credential writes.
        api(url, "Verify credential POST rejects missing sender secret", {})
    except YandexHttpError as exc:
        if exc.status == 401:
            return
        raise
    raise WebHostingError("Credential POST accepted a request without the sender secret.")


def verify_private(opener, function_id):
    request = Request(f"https://functions.yandexcloud.net/{function_id}?tag={TAG}&readiness=1")
    try:
        with opener.open(request, timeout=15):
            pass
    except HTTPError as exc:
        if exc.code in (401, 403):
            return
        raise WebHostingError(f"Anonymous invocation returned unexpected HTTP {exc.code}.") from None
    raise WebHostingError("Credential function allowed anonymous invocation.")


def main():
    folder = os.environ.get("YC_FOLDER_ID")
    deploy_sa = os.environ.get("YC_DEPLOY_SA_ID")
    token = os.environ.get("YC_IAM_TOKEN")
    mode = os.environ.get("CREDENTIAL_REPLICA_MODE")
    if not resource_id(folder) or not resource_id(deploy_sa) or not token or mode not in ("preview", "apply"):
        raise WebHostingError("Missing credential deployment identity or mode.")
    opener = build_opener(NoRedirect())
    api = partial(request_api, opener, token)
    secret, database, runtime, function = existing = check_existing(api, folder, deploy_sa)
    if mode == "preview":
        for entry, resource in zip(RESOURCES, existing):
            print(f"{entry[2]} ({entry[1]}): {'managed' if resource else 'to create'}")
        print("Preview only. Exact database access bindings and schema are verified during Apply.")
        return

    if not secret:
        value = os.environ.get(SECRET_ENV, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", value):
            raise WebHostingError(f"Set {SECRET_ENV} to a distinct base64url secret from secrets.token_urlsafe(32).")
        secret = ensure(api, folder, RESOURCES[0], deletionProtection=True, createVersion=True,
                        versionPayloadEntries=[{"key": SECRET_KEY, "textValue": value}])
    secrets = pinned_secret(secret)
    database = ensure(api, folder, RESOURCES[1], locationId="ru-central1",
                      deletionProtection=True, serverlessDatabase={"storageSizeLimit": str(1024**3)})
    endpoint, database_path = database_config(wait_database(api, database))
    runtime = ensure(api, folder, RESOURCES[2])
    runtime_id = runtime["id"]
    if runtime_id == deploy_sa:
        raise WebHostingError("Credential runtime and deployer must be distinct.")

    ensure_ydb_binding(api, database["id"], runtime_id, token)
    ensure_binding(api, f"{LOCKBOX}/{secret['id']}:updateAccessBindings",
                   lambda: access_bindings(api, secret["id"]),
                   binding("lockbox.payloadViewer", runtime_id), "Grant access to the isolated credential secret")

    sys.path.insert(0, str(SOURCE))
    import ydb
    from credential_store import connect, verify_schema

    try:
        store = connect(endpoint, database_path, ydb.AccessTokenCredentials(token), timeout=15)
        try:
            verify_schema(store, create=True)
        finally:
            pool, driver, _ = store
            pool.stop()
            driver.stop()
    except Exception:
        raise WebHostingError("Credential YDB schema creation or readback failed.") from None

    function = ensure(api, folder, RESOURCES[3])
    if function.get("status") != "ACTIVE":
        raise WebHostingError("Credential function is not active.")
    function_id = function["id"]
    invoker = binding("functions.functionInvoker", deploy_sa)
    ensure_binding(api, f"{FUNCTIONS}/{function_id}:updateAccessBindings",
                   lambda: function_bindings(api, function_id), invoker, "Grant deployer-only invocation")
    publish(api, function_id, runtime_id, endpoint, database_path, secrets)
    current_secret = find_managed(api, folder, RESOURCES[0])
    if (function_bindings(api, function_id) != [invoker]
            or not current_secret or pinned_secret(current_secret) != secrets
            or access_bindings(api, secret["id"]) != [binding("lockbox.payloadViewer", runtime_id)]):
        raise WebHostingError("Credential runtime permissions or secret pin changed.")
    verify_private(opener, function_id)
    print("Credential replica ready: schema verified, Lockbox pinned, anonymous invocation denied.")


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("CREDENTIAL_REPLICA: unexpected deployment failure.", file=sys.stderr)
        sys.exit(1)
