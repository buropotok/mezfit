"""Owner-gated Yandex Cloud Function + API Gateway Telegram OIDC deployment.

Preview is read-only. Apply creates/reuses one private function, publishes
pinned-secret Node 22 code, then (in an independently confirmed phase) adds
only the four /auth/* routes to the existing gateway. No /api/* changes.
"""

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from web_hosting import (
    FUNCTIONS, GATEWAYS, NAME_BROWSER_AUTH_FUNCTION, NAME_GATEWAY, NoRedirect,
    OPERATIONS, WebHostingError, await_operation, browser_auth_gateway_spec,
    bucket_name, choose, normalize_gateway_readback, paged_list, resource_id,
    spec_diff_paths, verify_gateway,
)

VERSIONS = "https://serverless-functions.api.cloud.yandex.net/functions/v1/versions"
PREPARE = "PREPARE_MEZFIT_BROWSER_LOGIN"
ACTIVATE = "ACTIVATE_MEZFIT_BROWSER_LOGIN"
TAG = "browser-login"
SOURCE = Path(__file__).parent / "browser-auth" / "index.js"


def request_api(opener, token, url, label, payload=None, method=None):
    verb = method or ("POST" if payload is not None else "GET")
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    req = Request(url, data=body, method=verb,
                  headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise WebHostingError(f"{label}: HTTP {error.code}; inspect scoped Yandex IAM and resource state.") from None
    except (URLError, OSError, ValueError):
        raise WebHostingError(f"{label}: Yandex API response unavailable or invalid.") from None
    if not isinstance(result, dict):
        raise WebHostingError(f"{label}: expected JSON object.")
    return result


def function_bindings(api, function_id):
    """Inspect the function's direct IAM grants. Never allow public invocation."""
    items = []
    page_token = ""
    seen = set()
    for _ in range(100):
        params = {"pageSize": "1000"}
        if page_token:
            params["pageToken"] = page_token
        result = api(f"{FUNCTIONS}/{function_id}:listAccessBindings?{urlencode(params)}",
                     "Read browser-auth function permissions")
        batch = result.get("accessBindings", [])
        if not isinstance(batch, list) or any(not isinstance(b, dict) for b in batch):
            raise WebHostingError("Malformed browser-auth IAM bindings.")
        items.extend(batch)
        page_token = result.get("nextPageToken", "")
        if not isinstance(page_token, str) or page_token in seen:
            raise WebHostingError("Malformed IAM binding pagination.")
        if not page_token:
            break
        seen.add(page_token)
    else:
        raise WebHostingError("IAM bindings pagination safety limit.")
    if any(item.get("subject", {}).get("type") == "system"
           and item.get("subject", {}).get("id") in {"allUsers", "allAuthenticatedUsers"}
           for item in items):
        raise WebHostingError("Public access on browser-auth function forbidden.")
    return items


def has_gateway_invoker(bindings, sa):
    return any(binding.get("roleId") == "functions.functionInvoker"
               and binding.get("subject") == {"type": "serviceAccount", "id": sa}
               for binding in bindings)


def source_package(source=SOURCE):
    content = source.read_bytes()
    if not content or len(content) > 512000:
        raise WebHostingError("Browser login handler source is missing or too large.")
    stream = io.BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        item = ZipInfo("index.js", date_time=(2026, 1, 1, 0, 0, 0))
        item.compress_type = ZIP_DEFLATED
        item.external_attr = 0o644 << 16
        archive.writestr(item, content)
    contents = stream.getvalue()
    digest = hashlib.sha256(contents).hexdigest()
    return contents, "MezFit browser OIDC code SHA256:" + digest


def function_version_list(api, function_id):
    rows = []
    token = ""
    seen = set()
    for _ in range(100):
        args = {"functionId": function_id, "pageSize": "1000"}
        if token:
            args["pageToken"] = token
        response = api(f"{VERSIONS}?{urlencode(args)}", "List browser login function versions")
        batch = response.get("versions", [])
        if not isinstance(batch, list) or any(not isinstance(item, dict) for item in batch):
            raise WebHostingError("Malformed function version list.")
        rows.extend(batch)
        token = response.get("nextPageToken", "")
        if not isinstance(token, str) or token in seen:
            raise WebHostingError("Malformed function version pagination.")
        if not token:
            return rows
        seen.add(token)
    raise WebHostingError("Function version pagination safety limit.")


def version_secrets(secret_id, secret_version):
    return [
        {"id": secret_id, "versionId": secret_version, "key": key,
         "environmentVariable": env}
        for key, env in (
            ("client_id", "TG_OIDC_CLIENT_ID"),
            ("client_secret", "TG_OIDC_CLIENT_SECRET"),
            ("session_secret", "MEZFIT_BROWSER_SESSION_SECRET"),
        )
    ]


def version_matches(version, fingerprint, sa, secret_id, secret_version, allowed_hosts):
    return (
        version.get("description") == fingerprint
        and version.get("status") == "ACTIVE"
        and version.get("runtime") == "nodejs22"
        and version.get("entrypoint") == "index.handler"
        and version.get("serviceAccountId") == sa
        and version.get("environment") == {"MEZFIT_AUTH_HOSTS": allowed_hosts}
        and version.get("secrets") == version_secrets(secret_id, secret_version)
        and TAG in version.get("tags", [])
    )


def select_tagged_version(versions):
    matches = [v for v in versions if TAG in v.get("tags", [])]
    if len(matches) > 1:
        raise WebHostingError("Multiple browser-login tagged versions; manual review.")
    return matches[0] if matches else None


def check_gateway(gateway, api, folder):
    if (not gateway or gateway.get("status") != "ACTIVE"
            or not resource_id(gateway.get("id"))
            or not isinstance(gateway.get("domain"), str)
            or not gateway["domain"].endswith(".apigw.yandexcloud.net")):
        raise WebHostingError("Approved SPA API Gateway must exist and be ACTIVE.")
    verify_gateway(gateway, folder, bucket_name(folder), api)


def gateway_spec_changed(api, gateway, wanted):
    response = api(f"{GATEWAYS}/{gateway['id']}:spec", "Read browser-login gateway routes")
    try:
        actual = json.loads(response["openapiSpec"])
    except (KeyError, TypeError, ValueError):
        raise WebHostingError("Cannot read existing gateway specification.") from None
    expected = normalize_gateway_readback(wanted, gateway.get("domain"))
    actual = normalize_gateway_readback(actual, gateway.get("domain"))
    return spec_diff_paths(expected, actual)


def execute(mode, action, confirm, folder, sa, secret_id, secret_version, api,
            update_api, sleep=time.sleep):
    if mode not in ("preview", "apply") or action not in ("prepare", "activate"):
        raise WebHostingError("Unknown browser auth operation.")
    if not resource_id(folder) or not resource_id(sa):
        raise WebHostingError("Missing YC_FOLDER_ID or YC_DEPLOY_SA_ID.")
    if mode == "apply" and confirm != (PREPARE if action == "prepare" else ACTIVATE):
        raise WebHostingError("Wrong explicit confirmation.")

    gateway = choose(paged_list(api, GATEWAYS, folder, "apiGateways", "List web gateways"),
                     NAME_GATEWAY, folder, "Existing SPA gateway")
    if not gateway:
        raise WebHostingError("SPA Gateway absent; browser login must reuse existing web infrastructure.")
    check_gateway(gateway, api, folder)
    function = choose(paged_list(api, FUNCTIONS, folder, "functions", "List Cloud Functions"),
                      NAME_BROWSER_AUTH_FUNCTION, folder, "Browser-login function")
    content, fingerprint = source_package()
    hosts = ",".join([gateway["domain"], "mezfit.online", "mezfit.ru"])

    if action == "prepare":
        if not resource_id(secret_id) or not resource_id(secret_version):
            if mode == "apply":
                raise WebHostingError("Configure pinned Yandex Lockbox secret ID + version ID before Apply.")
            print("PREVIEW: pinned Yandex Lockbox secret/version are not configured.")
        tagged = select_tagged_version(function_version_list(api, function["id"])) if function else None
        if tagged and (not resource_id(secret_id) or not resource_id(secret_version)
                       or not version_matches(tagged, fingerprint, sa, secret_id, secret_version, hosts)):
            raise WebHostingError("Existing tagged browser login function version differs; manual review required.")
        print(f"Browser login function: {'reuse' if function else 'create'}; "
              f"version: {'reuse' if tagged else 'publish'}; source digest {fingerprint[-64:]}.")
        print("No changes to current /api/*, Cloudflare, Dexie Cloud or domain delegation.")
        if mode == "preview":
            return
        if not function:
            if choose(paged_list(api, FUNCTIONS, folder, "functions", "Recheck functions"),
                      NAME_BROWSER_AUTH_FUNCTION, folder, "Browser-login function"):
                raise WebHostingError("Function appeared concurrently; Preview again.")
            response = await_operation(api, api(FUNCTIONS, "Create private browser-login function", {
                "folderId": folder, "name": NAME_BROWSER_AUTH_FUNCTION,
                "description": "MezFit browser Telegram OIDC, server-side token verification only",
            }), "Create browser login function", sleep)
            function = choose(paged_list(api, FUNCTIONS, folder, "functions", "Verify function"),
                              NAME_BROWSER_AUTH_FUNCTION, folder, "Browser-login function")
            if not function or function.get("id") != response.get("id"):
                raise WebHostingError("New function readback differs; inspect before retry.")
        bindings = function_bindings(api, function["id"])
        if not has_gateway_invoker(bindings, sa):
            access_update = api(f"{FUNCTIONS}/{function['id']}:updateAccessBindings",
                                "Grant only gateway service account permission to invoke private function",
                                {"accessBindingDeltas": [{
                                    "action": "ADD", "accessBinding": {
                                        "roleId": "functions.functionInvoker",
                                        "subject": {"type": "serviceAccount", "id": sa},
                                    },
                                }]})
            await_operation(api, access_update, "Grant browser login function invoke access", sleep)
            if not has_gateway_invoker(function_bindings(api, function["id"]), sa):
                raise WebHostingError("Private function invocation permission failed readback.")
        if not tagged:
            # Only the explicitly tagged version is invoked; a failed publish
            # cannot change the currently serving version.
            if select_tagged_version(function_version_list(api, function["id"])):
                raise WebHostingError("Function version changed concurrently; Preview again.")
            data = {
                "functionId": function["id"],
                "runtime": "nodejs22",
                "entrypoint": "index.handler",
                "resources": {"memory": "268435456"},
                "executionTimeout": "20s",
                "serviceAccountId": sa,
                "content": base64.b64encode(content).decode("ascii"),
                "environment": {"MEZFIT_AUTH_HOSTS": hosts},
                "tag": [TAG],
                "description": fingerprint,
                "secrets": version_secrets(secret_id, secret_version),
            }
            await_operation(api, api(VERSIONS, "Publish signed browser-login function version", data),
                            "Publish browser login version", sleep)
            tagged = select_tagged_version(function_version_list(api, function["id"]))
            if not tagged or not version_matches(tagged, fingerprint, sa, secret_id, secret_version, hosts):
                raise WebHostingError("Browser login function version failed strict readback.")
        print(f"Browser auth function prepared: {function['id']}. Activate gateway routes separately.")
        return

    if not function:
        raise WebHostingError("Browser auth function absent; run Prepare first.")
    if not has_gateway_invoker(function_bindings(api, function["id"]), sa):
        raise WebHostingError("Existing private auth function does not grant invocation to the approved gateway SA.")
    tagged = select_tagged_version(function_version_list(api, function["id"]))
    if (not resource_id(secret_id) or not resource_id(secret_version)
            or not tagged or not version_matches(tagged, fingerprint, sa, secret_id, secret_version, hosts)):
        raise WebHostingError("Expected ACTIVE tagged browser auth version with pinned Lockbox secrets is absent.")

    wanted = browser_auth_gateway_spec(bucket_name(folder), function["id"], sa)
    diffs = gateway_spec_changed(api, gateway, wanted)
    if not diffs:
        print("Four exact browser-login routes are already active; no gateway update.")
        return
    from web_hosting import gateway_spec
    original_diff = gateway_spec_changed(api, gateway, gateway_spec(bucket_name(folder)))
    if original_diff:
        raise WebHostingError("Existing gateway has unapproved change; do not overwrite routes.")
    print("Gateway plan: add only /auth/start, /auth/callback, /auth/session, /auth/logout")
    print("Existing /api/* stay 503. Browser session cannot be used as Mini App initData.")
    if mode == "preview":
        return

    fresh = choose(paged_list(api, GATEWAYS, folder, "apiGateways", "Recheck gateways"),
                   NAME_GATEWAY, folder, "Existing SPA gateway")
    check_gateway(fresh, api, folder)
    if gateway_spec_changed(api, fresh, gateway_spec(bucket_name(folder))):
        raise WebHostingError("Gateway changed concurrently; Preview again.")
    updated = update_api(f"{GATEWAYS}/{gateway['id']}", "Activate browser login gateway routes", {
        "updateMask": "openapiSpec",
        "openapiSpec": json.dumps(wanted, separators=(",", ":")),
    }, method="PATCH")
    await_operation(api, updated, "Activate browser login gateway", sleep)
    after = choose(paged_list(api, GATEWAYS, folder, "apiGateways", "Verify updated gateway"),
                   NAME_GATEWAY, folder, "Existing SPA gateway")
    check_gateway(after, api, folder)
    remaining = gateway_spec_changed(api, after, wanted)
    if remaining:
        raise WebHostingError("Gateway auth route readback differs: " + ", ".join(remaining))
    print("Browser login routes added; Mini App auth and existing API contracts unchanged.")


def main():
    token = os.environ.get("YC_IAM_TOKEN", "")
    if not token:
        raise WebHostingError("Missing short-lived Yandex IAM token.")
    opener = build_opener(NoRedirect())
    def api(url, label, payload=None):
        return request_api(opener, token, url, label, payload)
    def update_api(url, label, payload, method):
        return request_api(opener, token, url, label, payload, method)
    execute(os.environ.get("MODE", ""), os.environ.get("ACTION", ""),
            os.environ.get("CONFIRM", ""), os.environ.get("YC_FOLDER_ID", ""),
            os.environ.get("YC_DEPLOY_SA_ID", ""),
            os.environ.get("YC_LOGIN_LOCKBOX_ID", ""),
            os.environ.get("YC_LOGIN_LOCKBOX_VERSION_ID", ""),
            api, update_api)


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
