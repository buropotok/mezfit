"""Publish the checked-in media handler while carrying forward its live settings."""

import base64
import io
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zipfile import ZIP_DEFLATED, ZipFile

FUNCTIONS = "https://serverless-functions.api.cloud.yandex.net/functions/v1"
OPERATIONS = "https://operation.api.cloud.yandex.net/operations"
SOURCE = Path("infra/yandex-media-mvp/function")
SETTINGS = {
    "environment", "namedServiceAccounts", "concurrency", "connectivity",
    "secrets", "logOptions", "storageMounts", "asyncInvocationConfig",
    "tmpfsSize", "mounts", "metadataOptions",
}
VERSION_METADATA = {
    "id", "functionId", "description", "createdAt", "runtime", "entrypoint",
    "resources", "executionTimeout", "serviceAccountId", "imageSize", "status", "tags",
}
REQUIRED_BINDINGS = {
    "TELEGRAM_BOT_TOKEN", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY",
}


class DeployError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resource_id(value):
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9]+", value)


def request_json(opener, token, url, operation, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = Request(url, data=data, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise DeployError(f"{operation}: HTTP {error.code}. See deploy permissions in the runbook.") from None
    except (URLError, OSError, ValueError):
        raise DeployError(f"{operation}: API response unavailable or invalid.") from None
    if not isinstance(result, dict):
        raise DeployError(f"{operation}: expected a JSON object.")
    return result


def runtime_settings(version):
    if version.keys() - VERSION_METADATA - SETTINGS:
        raise DeployError("The API returned unsupported version fields. Review before publishing.")
    environment = version.get("environment", {})
    bindings = version.get("secrets", [])
    if not isinstance(environment, dict) or not all(isinstance(value, str) for value in environment.values()):
        raise DeployError("Cannot preserve the existing environment.")
    if not isinstance(bindings, list) or not all(
        isinstance(binding, dict) and all(
            isinstance(binding.get(key), str) and binding[key]
            for key in ("id", "key", "environmentVariable")
        ) for binding in bindings
    ):
        raise DeployError("Cannot preserve the existing Lockbox references.")
    binding_names = {binding["environmentVariable"] for binding in bindings}
    if not REQUIRED_BINDINGS <= binding_names or REQUIRED_BINDINGS & environment.keys():
        raise DeployError("Configure the three signer credentials as Lockbox bindings on the current version.")
    if not any(origin.strip() for origin in environment.get("MEDIA_ORIGINS", "").split(",")) and "MEDIA_ORIGINS" not in binding_names:
        raise DeployError("Configure MEDIA_ORIGINS on the current version.")
    # Preserve every documented writable setting as returned, including explicit empty/default values.
    return {key: version[key] for key in SETTINGS if key in version}


def package_source():
    archive = io.BytesIO()
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for filename in ("index.js", "package.json"):
            bundle.write(SOURCE / filename, filename)
    return base64.b64encode(archive.getvalue()).decode("ascii")


def deploy():
    function_id = os.environ.get("YC_FUNCTION_ID")
    folder_id = os.environ.get("YC_FOLDER_ID")
    runtime_account = os.environ.get("YC_RUNTIME_SA_ID")
    token = os.environ.get("YC_IAM_TOKEN")
    if not token or not all(resource_id(value) for value in (function_id, folder_id, runtime_account)):
        raise DeployError("Missing IAM token or invalid target configuration.")
    opener = build_opener(NoRedirect())

    def api(url, label, payload=None):
        return request_json(opener, token, url, label, payload)

    def latest():
        version = api(f"{FUNCTIONS}/versions:byTag?{query}", "Read current function version")
        if (version.get("functionId") != function_id or version.get("status") != "ACTIVE"
                or not resource_id(version.get("id")) or "$latest" not in version.get("tags", [])
                or version.get("serviceAccountId") != runtime_account):
            raise DeployError("Current active version or runtime service account does not match the target.")
        return version

    function = api(f"{FUNCTIONS}/functions/{function_id}", "Verify existing function")
    if (function.get("id") != function_id or function.get("folderId") != folder_id
            or function.get("name") != "mezfit-media-gateway" or function.get("status") != "ACTIVE"):
        raise DeployError("Function ID, folder, name or status does not match the target.")
    query = urlencode({"functionId": function_id, "tag": "$latest"})
    previous = latest()
    settings = runtime_settings(previous)
    print(f"Current version: {previous['id']}", flush=True)
    if os.environ.get("CHECK_ONLY") == "true":
        print("OIDC, version read access and signer configuration checks passed.")
        return

    release = {
        "runtime": "nodejs22",
        "entrypoint": "index.handler",
        "resources": {"memory": "134217728"},
        "executionTimeout": "10s",
        "serviceAccountId": runtime_account,
    }
    payload = {
        **settings, **release, "functionId": function_id,
        "description": f"Mezfit media handler from {os.environ['GITHUB_SHA']}",
        "content": package_source(),
    }
    if latest()["id"] != previous["id"]:
        raise DeployError("Current version changed during preparation. Restart after inspecting the change.")
    operation = api(f"{FUNCTIONS}/versions", "Publish function version", payload)
    operation_id = operation.get("id")
    if not resource_id(operation_id):
        raise DeployError("Invalid publish operation ID. Check Yandex before retrying.")
    print(f"Publish operation: {operation_id}", flush=True)
    deadline = time.monotonic() + 480
    while operation.get("done") is not True and time.monotonic() < deadline:
        time.sleep(5)
        operation = api(f"{OPERATIONS}/{operation_id}", "Read publish operation")
    if operation.get("done") is not True:
        raise DeployError("Publication did not finish in time. Check the operation before retrying.")
    result = operation.get("response")
    if operation.get("error") or not isinstance(result, dict) or not resource_id(result.get("id")):
        raise DeployError("Yandex did not report a successful publication. Inspect the operation in Yandex Cloud.")

    published = latest()
    if (published["id"] != result["id"] or published["id"] == previous["id"]
            or any(published.get(key) != value for key, value in release.items())
            or runtime_settings(published) != settings):
        raise DeployError("Published version or its runtime configuration differs from the request. Inspect both versions.")
    print(f"Verified published version: {published['id']}")


if __name__ == "__main__":
    try:
        deploy()
    except (DeployError, OSError, KeyError, TypeError) as error:
        message = str(error) if isinstance(error, DeployError) else "Invalid deployment configuration or unreadable package."
        print(message, file=sys.stderr)
        sys.exit(1)
