"""Owner-confirmed provisioning for a standalone Telegram JWKS mirror.

No browser auth, Gateway, Dexie, or existing Cloudflare Worker changes.
The one-time S3 secret is written only to an explicitly supplied runner temp path.
"""
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from browser_auth_bootstrap import RUNTIME_ACCOUNT_NAME
from web_hosting import (NoRedirect, STORAGE, WebHostingError, await_operation,
                         choose, paged_list, resource_id)

IAM_SA = "https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts"
IAM_KEYS = "https://iam.api.cloud.yandex.net/iam/aws-compatibility/v1/accessKeys"
NAME_SA = "mezfit-jwks-publisher"
APPROVALS = {"prepare": "PREPARE_MEZFIT_JWKS_MIRROR",
             "activate": "ACTIVATE_MEZFIT_JWKS_MIRROR",
             "upgrade": "UPGRADE_MEZFIT_JWKS_MIRROR"}
PRIVATE = {"read": False, "list": False, "configRead": False}


def bucket_name(folder):
    return f"mezfit-telegram-jwks-{folder}"


def expected_binding(account_id):
    return {"roleId": "storage.uploader",
            "subject": {"type": "serviceAccount", "id": account_id}}


def reader_binding(account_id):
    return {"roleId": "storage.viewer",
            "subject": {"type": "serviceAccount", "id": account_id}}


def validate_inputs(mode, action, confirm, folder, deploy_sa):
    if mode not in ("preview", "apply") or action not in APPROVALS:
        raise WebHostingError("Unknown operator mode or action.")
    if not resource_id(folder) or not resource_id(deploy_sa):
        raise WebHostingError("YC_FOLDER_ID and YC_DEPLOY_SA_ID must be valid.")
    if mode == "apply" and confirm != APPROVALS[action]:
        raise WebHostingError("Explicit owner approval missing for selected JWKS action.")


def check_bucket(bucket, folder, deploy_sa):
    if bucket.get("name") != bucket_name(folder) or bucket.get("folderId") != folder:
        raise WebHostingError("JWKS bucket name/ownership drift.")
    if bucket.get("anonymousAccessFlags") != PRIVATE:
        raise WebHostingError("JWKS bucket must remain private.")
    if bucket.get("disabledStatickeyAuth") is True:
        raise WebHostingError("Static S3 authentication disabled for JWKS bucket.")
    if bucket.get("policy") not in ({}, None) or bucket.get("cors") not in ([], None):
        raise WebHostingError("Unexpected JWKS bucket policy or CORS settings.")
    website = bucket.get("websiteSettings")
    empty_website = {"index": "", "error": "", "routingRules": [], "redirectAllRequests": {}}
    if website not in ({}, None) and (not isinstance(website, dict)
            or any(k not in empty_website or v not in (empty_website[k], None)
                   for k, v in website.items())):
        raise WebHostingError("JWKS bucket may not serve a static website.")
    grants = bucket.get("acl", {}).get("grants", [])
    if not isinstance(grants, list) or any(
        g.get("grantType") != "GRANT_TYPE_ACCOUNT" or g.get("granteeId") != deploy_sa for g in grants
    ):
        raise WebHostingError("Unexpected JWKS bucket ACL; manual review.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", bucket.get("resourceId", "")):
        raise WebHostingError("Missing JWKS bucket IAM resource ID.")
    return bucket["resourceId"]


def read_bindings(api, resource_id_value, label="JWKS bucket"):
    result = api(f"{STORAGE}/{resource_id_value}:listAccessBindings",
                 f"Read {label} IAM")
    bindings = result.get("accessBindings", [])
    if (not isinstance(bindings, list) or
            any(not isinstance(row, dict) for row in bindings) or result.get("nextPageToken")):
        raise WebHostingError(f"Unexpected/paginated {label} IAM grants; manual review.")
    return bindings


def list_keys(api, sa_id):
    result = api(f"{IAM_KEYS}?{urlencode({'serviceAccountId': sa_id, 'pageSize': '1000'})}",
                 "Inspect JWKS publisher key metadata")
    keys = result.get("accessKeys", [])
    if not isinstance(keys, list) or result.get("nextPageToken"):
        raise WebHostingError("Unexpected/paginated publisher keys; manual review.")
    if any(not isinstance(key, dict) or key.get("serviceAccountId") != sa_id for key in keys):
        raise WebHostingError("Publisher access key metadata invalid.")
    return keys


def inspect(api, folder, deploy_sa):
    sa = choose(paged_list(api, IAM_SA, folder, "serviceAccounts",
                           "List Yandex service accounts"),
                NAME_SA, folder, "JWKS publisher")
    bucket = choose(paged_list(api, STORAGE, folder, "buckets", "List Yandex buckets"),
                    bucket_name(folder), folder, "JWKS private bucket")
    if sa and not resource_id(sa.get("id")):
        raise WebHostingError("JWKS publisher ID invalid.")
    if bucket:
        # Bucket.List may omit resourceId and ACL. Resolve authoritative metadata.
        bucket = api(f"{STORAGE}/{bucket_name(folder)}?view=VIEW_FULL",
                     "Read exact JWKS bucket settings")
    bindings = read_bindings(api, check_bucket(bucket, folder, deploy_sa)) if bucket else []
    if bindings:
        writer = expected_binding(sa["id"]) if sa else None
        if bindings != [writer]:
            runtime = choose(paged_list(api, IAM_SA, folder, "serviceAccounts",
                                        "List Yandex service accounts"),
                             RUNTIME_ACCOUNT_NAME, folder, "Browser login runtime")
            if (not writer or not runtime or not resource_id(runtime.get("id"))
                    or runtime["id"] == sa["id"] or len(bindings) != 2
                    or writer not in bindings or reader_binding(runtime["id"]) not in bindings):
                raise WebHostingError("JWKS bucket IAM drift; not overwriting existing grants.")
    keys = list_keys(api, sa["id"]) if sa else []
    return sa, bucket, bindings, keys


def execute(mode, action, confirm, folder, deploy_sa, api, output_file=None, sleep=None):
    validate_inputs(mode, action, confirm, folder, deploy_sa)
    sa, bucket, bindings, keys = inspect(api, folder, deploy_sa)
    if action == "prepare":
        if keys:
            raise WebHostingError("Existing JWKS publisher access key requires separate rotation procedure.")
        print(f"JWKS publisher: {'reuse' if sa else 'create'}; "
              f"private bucket: {'reuse' if bucket else 'create'}; "
              f"bucket-scoped storage.uploader: {'verified' if bindings else 'install'}.")
        if mode == "preview":
            return
        if not sa:
            await_operation(api, api(IAM_SA, "Create dedicated JWKS publisher", {
                "folderId": folder, "name": NAME_SA,
                "description": "MezFit Telegram public JWKS mirror; dedicated bucket only",
            }), "Create JWKS publisher", sleep or time.sleep)
        if not bucket:
            await_operation(api, api(STORAGE, "Create private JWKS bucket", {
                "folderId": folder, "name": bucket_name(folder),
                "anonymousAccessFlags": PRIVATE, "maxSize": "10485760",
            }), "Create JWKS bucket", sleep or time.sleep)
        sa, bucket, bindings, keys = inspect(api, folder, deploy_sa)
        if not sa or not bucket or keys:
            raise WebHostingError("JWKS resources absent or changed after creation.")
        if not bindings:
            # Recheck immediately before the only IAM mutation; no destructive setAccessBindings.
            if read_bindings(api, bucket["resourceId"]):
                raise WebHostingError("Concurrent JWKS IAM change; run Preview again.")
            await_operation(api, api(
                f"{STORAGE}/{bucket['resourceId']}:updateAccessBindings",
                "Grant JWKS writer on dedicated bucket", {
                    "accessBindingDeltas": [
                        {"action": "ADD", "accessBinding": expected_binding(sa["id"])}
                    ]
                }, method="PATCH"), "Grant JWKS writer", sleep or time.sleep)
        sa, bucket, bindings, keys = inspect(api, folder, deploy_sa)
        if not sa or not bucket or expected_binding(sa["id"]) not in bindings or keys:
            raise WebHostingError("JWKS provisioning readback failed.")
        print("JWKS infrastructure prepared; no access key has been created.")
        return

    if not sa or not bucket or expected_binding(sa["id"]) not in bindings:
        raise WebHostingError("Prepare JWKS private bucket and scoped publisher first.")
    if action == "upgrade":
        if len(keys) != 1:
            raise WebHostingError("Upgrade requires exactly one existing JWKS S3 key; no rotation is allowed.")
        print("JWKS upgrade: reuse existing Cloudflare Worker and unchanged S3 key. No Yandex writes.")
        return
    if keys:
        raise WebHostingError("JWKS access key already exists. Refusing to mint/rotate it automatically.")
    print("JWKS activation: issue exactly one S3 key and deploy isolated Cloudflare Worker.")
    if mode == "preview":
        return
    if not output_file:
        raise WebHostingError("Missing private runner credentials path.")
    target = Path(output_file)
    if not target.parent.is_dir() or target.exists():
        raise WebHostingError("Credentials path must be new in a pre-existing runner temp directory.")
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        response = api(IAM_KEYS, "Create one-time JWKS publisher S3 key", {
            "serviceAccountId": sa["id"],
            "description": "MezFit isolated Telegram JWKS mirror Worker",
        })
        key = response.get("accessKey", {})
        if (key.get("serviceAccountId") != sa["id"] or
                not re.fullmatch(r"[A-Za-z0-9_-]{5,128}", key.get("keyId", "")) or
                not isinstance(response.get("secret"), str) or len(response["secret"]) < 20):
            raise WebHostingError("S3 key creation response invalid; inspect keys before retry.")
        json.dump({"YC_JWKS_ACCESS_KEY_ID": key["keyId"],
                   "YC_JWKS_SECRET_ACCESS_KEY": response["secret"]}, handle)
    if len(list_keys(api, sa["id"])) != 1:
        raise WebHostingError("Publisher S3 key readback failed; manual investigation.")
    print("One S3 key created. Credentials staged only in protected runner temp file.")


def main():
    token = os.environ.get("YC_IAM_TOKEN", "")
    mode = os.environ.get("JWKS_MODE", "preview")
    action = os.environ.get("JWKS_ACTION", "prepare")
    confirm = os.environ.get("JWKS_CONFIRM", "")
    folder = os.environ.get("YC_FOLDER_ID", "")
    deploy_sa = os.environ.get("YC_DEPLOY_SA_ID", "")
    try:
        if not token:
            raise WebHostingError("Missing short-lived Yandex IAM token.")
        opener = build_opener(NoRedirect)

        def api(url, label, payload=None, method=None):
            verb = method or ("POST" if payload is not None else "GET")
            body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
            request = Request(url, data=body, method=verb,
                              headers={"Authorization": f"Bearer {token}",
                                       "Content-Type": "application/json"})
            try:
                with opener.open(request, timeout=30) as response:
                    result = json.load(response)
            except HTTPError as error:
                raise WebHostingError(f"{label}: HTTP {error.code}; inspect scoped Yandex IAM.") from None
            except (URLError, OSError, ValueError):
                raise WebHostingError(f"{label}: Yandex API unavailable or invalid.") from None
            if not isinstance(result, dict):
                raise WebHostingError(f"{label}: expected JSON object.")
            return result

        execute(mode, action, confirm, folder, deploy_sa, api,
                os.environ.get("JWKS_CREDENTIALS_FILE"))
    except WebHostingError as error:
        print(f"JWKS operator: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
