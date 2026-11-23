"""Idempotent Yandex IAM + Lockbox bootstrap using GitHub Actions Secrets.

The first explicitly confirmed Prepare reads TELEGRAM_LOGIN_CLIENT_SECRET from
the owner-only GitHub Actions runner and writes it directly into a protected
Yandex Lockbox secret using HTTPS, without printing or persisting its value.
Subsequent runs read metadata only; they never fetch the secret payload or
implicitly rotate the session key.

The deployment service account needs IAM and Lockbox administration privileges
for this one-time bootstrap. The created runtime service account receives ONLY
lockbox.payloadViewer on this exact new Lockbox secret.
"""

import os
import secrets
import time

from web_hosting import WebHostingError, await_operation, choose, paged_list, resource_id


IAM_SERVICE_ACCOUNTS = "https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts"
LOCKBOX = "https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets"
RUNTIME_ACCOUNT_NAME = "mezfit-browser-auth-runtime"
SECRET_NAME = "mezfit-browser-telegram-oidc"
EXPECTED_KEYS = frozenset({"client_id", "client_secret", "session_secret"})
RUNTIME_PAYLOAD_ROLE = "lockbox.payloadViewer"


def identify_resources(api, folder):
    runtime = choose(
        paged_list(api, IAM_SERVICE_ACCOUNTS, folder, "serviceAccounts",
                   "List browser login runtime service accounts"),
        RUNTIME_ACCOUNT_NAME, folder, "Browser login runtime service account")
    if runtime is not None and not resource_id(runtime.get("id")):
        raise WebHostingError("Browser runtime service account has an invalid ID.")

    lockbox = choose(
        paged_list(api, LOCKBOX, folder, "secrets", "List browser login Lockbox secrets"),
        SECRET_NAME, folder, "Browser login Lockbox secret")
    if lockbox is not None:
        verify_secret_metadata(lockbox, folder)
    return runtime, lockbox


def verify_secret_metadata(secret, folder):
    if (secret.get("name") != SECRET_NAME
            or secret.get("folderId") != folder
            or secret.get("deletionProtection") is not True
            or secret.get("status") != "ACTIVE"
            or not resource_id(secret.get("id"))):
        raise WebHostingError("Existing browser login Lockbox secret has unexpected configuration.")
    current = secret.get("currentVersion")
    if (not isinstance(current, dict)
            or not resource_id(current.get("id"))
            or current.get("secretId") != secret["id"]
            or current.get("status") != "ACTIVE"
            or not isinstance(current.get("payloadEntryKeys"), list)
            or len(current["payloadEntryKeys"]) != len(EXPECTED_KEYS)
            or set(current["payloadEntryKeys"]) != EXPECTED_KEYS):
        raise WebHostingError("Existing Lockbox current version has unexpected key metadata.")
    return current["id"]


def access_bindings(api, secret_id):
    result = []
    token = ""
    seen = set()
    for _ in range(100):
        params = {"pageSize": "1000"}
        if token:
            params["pageToken"] = token
        from urllib.parse import urlencode
        page = api(f"{LOCKBOX}/{secret_id}:listAccessBindings?{urlencode(params)}",
                   "Check scoped Lockbox access bindings")
        items = page.get("accessBindings", [])
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise WebHostingError("Malformed Lockbox access binding list.")
        result.extend(items)
        token = page.get("nextPageToken", "")
        if not isinstance(token, str) or token in seen:
            raise WebHostingError("Malformed Lockbox access binding pagination.")
        if not token:
            return result
        seen.add(token)
    raise WebHostingError("Lockbox access binding pagination exceeded.")


def validate_access(bindings, runtime_id):
    """Reject direct public payload access or another payloadViewer identity."""
    target = {"type": "serviceAccount", "id": runtime_id}
    present = False
    for binding in bindings:
        subject = binding.get("subject")
        if not isinstance(subject, dict):
            raise WebHostingError("Malformed Lockbox access subject.")
        if (subject.get("type") == "system"
                and subject.get("id") in {"allUsers", "allAuthenticatedUsers"}):
            raise WebHostingError("Public Lockbox access binding is forbidden.")
        if binding.get("roleId") == RUNTIME_PAYLOAD_ROLE:
            if subject != target:
                raise WebHostingError("Unexpected Lockbox payload viewer; manual review required.")
            present = True
    return present


def secret_entries(client_id, client_secret):
    if not isinstance(client_id, str) or not client_id.isascii() or not client_id.isdecimal():
        raise WebHostingError("TELEGRAM_LOGIN_CLIENT_ID must be a decimal BotFather Client ID.")
    if not 4 <= len(client_id) <= 20 or client_id.startswith("0"):
        raise WebHostingError("Invalid Telegram OIDC Client ID.")
    if not isinstance(client_secret, str) or len(client_secret) < 16 or len(client_secret) > 2048:
        raise WebHostingError("TELEGRAM_LOGIN_CLIENT_SECRET GitHub Actions Secret is missing or invalid.")
    # Generated on GitHub's ephemeral runner; transmitted only via TLS to
    # Lockbox, and never copied to workflow outputs or repository variables.
    return [
        {"key": "client_id", "textValue": client_id},
        {"key": "client_secret", "textValue": client_secret},
        {"key": "session_secret", "textValue": secrets.token_urlsafe(48)},
    ]


def bootstrap(mode, action, folder, api, sleep=time.sleep,
              client_id=None, client_secret=None):
    """Return runtime SA ID, protected Lockbox ID and pinned current version.

    Preview is read-only. Prepare Apply is the only phase allowed to write.
    An existing Lockbox secret is reused without reading its payload.
    """
    if mode not in {"preview", "apply"} or action not in {"prepare", "activate", "upgrade"}:
        raise WebHostingError("Invalid browser login bootstrap mode/action.")
    if not resource_id(folder):
        raise WebHostingError("Missing approved YC_FOLDER_ID.")

    runtime, lockbox = identify_resources(api, folder)
    print(f"Browser runtime SA: {'reuse' if runtime else 'create'}; "
          f"Lockbox secret: {'reuse' if lockbox else 'create'}.")

    # Preview, Activate and Upgrade are metadata-only and cannot initialize a
    # privileged account or materialize a GitHub secret in Yandex Cloud.
    if mode == "preview" or action in {"activate", "upgrade"}:
        if lockbox and runtime:
            grants = access_bindings(api, lockbox["id"])
            enabled = validate_access(grants, runtime["id"])
            if not enabled and action in {"activate", "upgrade"}:
                raise WebHostingError("Browser runtime account lacks scoped Lockbox access.")
        elif action in {"activate", "upgrade"}:
            raise WebHostingError("Browser login runtime SA/Lockbox absent; run Prepare first.")
        return (
            runtime["id"] if runtime else "",
            lockbox["id"] if lockbox else "",
            verify_secret_metadata(lockbox, folder) if lockbox else "",
        )

    # A pending Apply must validate the Github secret BEFORE any writes.
    # Already initialized deployments never read or overwrite the payload.
    entries = None if lockbox else secret_entries(
        os.environ.get("TELEGRAM_LOGIN_CLIENT_ID", "") if client_id is None else client_id,
        os.environ.get("TELEGRAM_LOGIN_CLIENT_SECRET", "") if client_secret is None else client_secret,
    )

    if not runtime:
        if identify_resources(api, folder)[0]:
            raise WebHostingError("Runtime service account appeared concurrently; repeat Preview.")
        operation = api(IAM_SERVICE_ACCOUNTS, "Create isolated browser auth runtime identity", {
            "folderId": folder, "name": RUNTIME_ACCOUNT_NAME,
            "description": "MezFit browser login; may read one Lockbox secret only",
        })
        result = await_operation(api, operation, "Create browser auth runtime service account", sleep)
        runtime, visible = identify_resources(api, folder)
        if not runtime or runtime.get("id") != result.get("id") or visible != lockbox:
            raise WebHostingError("New browser auth runtime service account failed readback.")

    if not lockbox:
        if identify_resources(api, folder)[1]:
            raise WebHostingError("Lockbox secret appeared concurrently; repeat Preview.")
        operation = api(LOCKBOX, "Create protected browser auth Lockbox secret", {
            "folderId": folder, "name": SECRET_NAME,
            "description": "Only Telegram browser OIDC credentials and session signing key",
            "deletionProtection": True,
            "createVersion": True,
            "versionDescription": "Initial GitHub Actions bootstrap",
            "versionPayloadEntries": entries,
        })
        result = await_operation(api, operation, "Create browser auth Lockbox secret", sleep)
        visible_runtime, lockbox = identify_resources(api, folder)
        if (visible_runtime != runtime or not lockbox
                or lockbox.get("id") != result.get("id")):
            raise WebHostingError("New protected Lockbox secret failed readback verification.")

    existing = access_bindings(api, lockbox["id"])
    if not validate_access(existing, runtime["id"]):
        if validate_access(access_bindings(api, lockbox["id"]), runtime["id"]):
            raise WebHostingError("Lockbox access changed concurrently; repeat Preview.")
        operation = api(f"{LOCKBOX}/{lockbox['id']}:updateAccessBindings",
                        "Grant browser runtime access to its exact Lockbox secret", {
            "accessBindingDeltas": [{
                "action": "ADD",
                "accessBinding": {
                    "roleId": RUNTIME_PAYLOAD_ROLE,
                    "subject": {"type": "serviceAccount", "id": runtime["id"]},
                },
            }],
        })
        await_operation(api, operation, "Grant scoped runtime Lockbox payload access", sleep)
        if not validate_access(access_bindings(api, lockbox["id"]), runtime["id"]):
            raise WebHostingError("Runtime Lockbox binding failed readback verification.")

    print("Runtime service account and pinned Lockbox version are ready.")
    return runtime["id"], lockbox["id"], verify_secret_metadata(lockbox, folder)
