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
import re
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from web_hosting import (
    FUNCTIONS, GATEWAYS, NAME_BROWSER_AUTH_FUNCTION, NAME_GATEWAY, NoRedirect,
    OPERATIONS, STORAGE, WebHostingError, await_operation, browser_auth_gateway_spec,
    bucket_name, choose, normalize_gateway_readback, paged_list, resource_id,
    spec_diff_paths, verify_gateway,
)

VERSIONS = "https://serverless-functions.api.cloud.yandex.net/functions/v1/versions"
PREPARE = "PREPARE_MEZFIT_BROWSER_LOGIN"
ACTIVATE = "ACTIVATE_MEZFIT_BROWSER_LOGIN"
UPGRADE = "UPGRADE_MEZFIT_BROWSER_LOGIN_DIAGNOSTICS"
POPUP = "ENABLE_MEZFIT_BROWSER_LOGIN_POPUP"
POPUP_ROLLBACK = "ROLLBACK_MEZFIT_BROWSER_LOGIN_POPUP"
TAG = "browser-login"
PREVIOUS_TAG = "browser-login-pre-diagnostics"
PRE_POPUP_TAG = "browser-login-pre-popup"
DIAGNOSTICS_FINGERPRINT = ("MezFit browser OIDC code SHA256:"
                           "a597bd9d1a9f9235f95cf0dd8fa0115bcc9b9ec7f0f06f3aa0148eb70080c95a")
# Verified against the first successful production Prepare Apply GitHub Actions
# run 45107553050. Reject changes from any other serving baseline.
BASELINE_FINGERPRINT = ("MezFit browser OIDC code SHA256:"
                        "92f77f2f6ddfdc89bd29a85895ac613197c608ccd7c8e209b884f2abcadfed4f")
SOURCE = Path(__file__).parent / "browser-auth" / "index.js"


class YandexHttpError(WebHostingError):
    def __init__(self, label, status, *, nonce_policy_readback=None):
        self.status = status
        self.nonce_policy_readback = nonce_policy_readback
        super().__init__(f"{label}: HTTP {status}; inspect scoped Yandex IAM and resource state.")


def approved_nonce_lifecycle_xml(body):
    # S3 returns the effective rule, including all filters and actions.
    # Compare the exact tree, ignoring only element order and the S3 namespace.
    text = body.decode("utf-8")
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        return False
    namespace = "{http://s3.amazonaws.com/doc/2006-03-01/}"

    def tree(element):
        if element.attrib or (element.tail or "").strip():
            raise ValueError("unexpected lifecycle XML markup")
        return (
            element.tag.removeprefix(namespace),
            (element.text or "").strip() if len(element) else (element.text or ""),
            sorted(tree(child) for child in element),
        )

    try:
        actual = tree(ElementTree.fromstring(text))
    except (ElementTree.ParseError, ValueError):
        return False
    for prefix in ("<Filter><Prefix>used/</Prefix></Filter>", "<Prefix>used/</Prefix>"):
        expected = ElementTree.fromstring(
            "<LifecycleConfiguration><Rule><ID>expire-used-nonces</ID>"
            "<Status>Enabled</Status>" + prefix + "<Expiration><Days>1</Days></Expiration>"
            "</Rule></LifecycleConfiguration>"
        )
        if actual == tree(expected):
            return True
    return False


def request_api(opener, token, url, label, payload=None, method=None):
    verb = method or ("POST" if payload is not None else "GET")
    nonce_bindings = re.fullmatch(
        re.escape(STORAGE) + r"/(mezfit-browser-nonce-[0-9a-f]{16}):listAccessBindings", url,
    )
    if verb == "GET" and nonce_bindings:
        # Storage management reads use the bucket name. IAM attaches to the
        # distinct resourceId returned by Bucket.Get, not its name or id.
        bucket = nonce_bindings[1]
        metadata = request_api(opener, token, f"{STORAGE}/{bucket}?view=VIEW_BASIC",
                               "Resolve nonce bucket IAM resource ID")
        identity = metadata.get("resourceId")
        if metadata.get("name") != bucket or not isinstance(identity, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{1,64}", identity):
            raise WebHostingError("Nonce bucket IAM resource ID missing or invalid.")
        url = f"{STORAGE}/{identity}:listAccessBindings"
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if verb == "PUT" and body is not None:
        headers["Content-MD5"] = base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest()).decode("ascii")
    req = Request(url, data=body, method=verb, headers=headers)
    try:
        with opener.open(req, timeout=30) as response:
            if verb == "GET" and url.startswith("https://storage.yandexcloud.net/mezfit-browser-nonce-") and url.endswith("?lifecycle"):
                body = response.read(32_769)
                result = {"approved": len(body) <= 32_768 and approved_nonce_lifecycle_xml(body)}
            else:
                result = {} if verb == "PUT" else json.load(response)
    except HTTPError as error:
        nonce_policy_readback = None
        nonce_full_view = re.fullmatch(
            re.escape(STORAGE) + r"/(mezfit-browser-nonce-[0-9a-f]{16})\?view=VIEW_FULL", url,
        )
        if verb == "GET" and error.code == 403 and nonce_full_view:
            bucket = nonce_full_view[1]
            try:
                nonce_policy_readback = request_api(
                    opener, token, f"https://storage.yandexcloud.net/{bucket}?policy", "S3 GetBucketPolicy",
                )
            except YandexHttpError as probe_error:
                nonce_policy_readback = f"HTTP {probe_error.status}"
            except WebHostingError:
                nonce_policy_readback = "response unavailable or invalid"
        raise YandexHttpError(label, error.code, nonce_policy_readback=nonce_policy_readback) from None
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


def has_gateway_invoker(bindings, deploy_sa):
    return any(binding.get("roleId") == "functions.functionInvoker"
               and binding.get("subject") == {"type": "serviceAccount", "id": deploy_sa}
               for binding in bindings)


def source_package(source=SOURCE):
    content = source.read_bytes()
    if not content or len(content) > 512000:
        raise WebHostingError("Browser login handler source is missing or too large.")
    stream = io.BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, data in (
            ("index.js", content),
            ("package.json", (source.parent / "package.json").read_bytes()),
        ):
            item = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = ZIP_DEFLATED
            item.external_attr = 0o644 << 16
            archive.writestr(item, data)
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


def version_matches(version, fingerprint, sa, secret_id, secret_version, allowed_hosts, *, tagged=True,
                    nonce_bucket=None):
    environment = {"MEZFIT_AUTH_HOSTS": allowed_hosts}
    if nonce_bucket:
        environment["MEZFIT_BROWSER_CHALLENGE_BUCKET"] = nonce_bucket
    return (
        resource_id(version.get("id"))
        and version.get("description") == fingerprint
        and version.get("status") == "ACTIVE"
        and version.get("runtime") == "nodejs22"
        and version.get("entrypoint") == "index.handler"
        and version.get("serviceAccountId") == sa
        and version.get("environment") == environment
        and version.get("secrets") == version_secrets(secret_id, secret_version)
        and (TAG in version.get("tags", []) if tagged else TAG not in version.get("tags", []))
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


def require_confirmation(mode, action, confirmation):
    """Validate the action BEFORE bootstrap can create any Yandex resources."""
    expected = {"prepare": PREPARE, "activate": ACTIVATE, "upgrade": UPGRADE,
                "popup": POPUP, "popup-rollback": POPUP_ROLLBACK}
    if mode not in ("preview", "apply") or action not in expected:
        raise WebHostingError("Unknown browser auth operation.")
    if mode == "apply" and confirmation != expected[action]:
        raise WebHostingError("Wrong explicit confirmation.")


def nonce_bucket_name(folder):
    return "mezfit-browser-nonce-" + hashlib.sha256(folder.encode()).hexdigest()[:16]


def nonce_bucket_contract(folder, runtime_sa):
    bucket = nonce_bucket_name(folder)
    flags = {"read": False, "list": False, "configRead": False}
    lifecycle = [{"id": "expire-used-nonces", "enabled": True,
                  "filter": {"prefix": "used/"}, "expiration": {"days": "1"}}]
    settings = {"name": bucket, "folderId": folder, "defaultStorageClass": "STANDARD",
                "anonymousAccessFlags": flags, "versioning": "VERSIONING_DISABLED",
                "tags": [{"key": "mezfit-purpose", "value": "browser-login-nonce"}],
                "lifecycleRules": lifecycle}
    policy = {"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": {"CanonicalUser": [runtime_sa]},
        "Action": ["s3:PutObject"], "Resource": [f"arn:aws:s3:::{bucket}/used/*"],
        "Condition": {"Null": {"s3:if-none-match": "false"},
                      "Bool": {"aws:SecureTransport": "true"}},
    }]}
    return settings, policy


def deploy_nonce_bucket_policy(folder, deploy_sa, runtime_sa):
    if not resource_id(deploy_sa) or deploy_sa == runtime_sa:
        raise WebHostingError("Nonce bucket requires a distinct deploy service account.")
    settings, legacy = nonce_bucket_contract(folder, runtime_sa)
    readback = {
        "Effect": "Allow", "Principal": {"CanonicalUser": [deploy_sa]},
        "Action": ["s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLocation",
                   "s3:GetBucketVersioning", "s3:GetBucketWebsite", "s3:GetEncryptionConfiguration",
                   "s3:GetLifecycleConfiguration"],
        "Resource": [f"arn:aws:s3:::{settings['name']}"],
        "Condition": {"Bool": {"aws:SecureTransport": "true"}},
    }
    return {**legacy, "Statement": [*legacy["Statement"], readback]}


def nonce_policy_readback_diff(actual, expected):
    """Report mismatched fields without printing any data from the policy."""
    fields = ("Effect", "Principal", "Action", "Resource", "Condition")
    differences = []
    if actual.get("Version") != expected["Version"]:
        differences.append("Version")
    if "Id" in actual:
        differences.append("Id present")
    if actual.keys() - {"Version", "Id", "Statement"}:
        differences.append("unexpected top-level fields")
    rules = actual.get("Statement")
    if isinstance(rules, dict):
        rules = [rules]
        differences.append("Statement is an object")
    if not isinstance(rules, list):
        return ", ".join([*differences, "Statement is missing or invalid"])

    def as_list(value):
        return [value] if isinstance(value, str) else value

    expected_rules = expected["Statement"]
    if len(rules) != len(expected_rules):
        differences.append(f"Statement count {len(rules)} (expected {len(expected_rules)})")
    for index, rule in enumerate(expected_rules):
        candidates = [
            item for item in rules
            if isinstance(item, dict) and as_list(item.get("Resource")) == rule["Resource"]
        ]
        if len(candidates) != 1:
            differences.append(f"expected rule {index + 1}: resource missing or ambiguous")
            continue
        observed = candidates[0]
        changed = [field for field in fields if observed.get(field) != rule[field]]
        if "Resource" in changed:
            changed.append("Resource scalar form")
        actions = as_list(observed.get("Action"))
        if ("Action" in changed and isinstance(actions, list)
                and all(isinstance(action, str) for action in actions)):
            missing = [action for action in rule["Action"] if action not in actions]
            extra = sum(action not in rule["Action"] for action in actions)
            if missing or extra:
                changed.append(f"missing actions [{', '.join(missing)}], unexpected actions {extra}")
            elif len(actions) == len(rule["Action"]):
                changed.append("same actions in different JSON form")
        if "Condition" in changed and isinstance(observed.get("Condition"), dict):
            for operator, conditions in rule["Condition"].items():
                actual_conditions = observed["Condition"].get(operator)
                if not isinstance(actual_conditions, dict):
                    changed.append(f"Condition.{operator} missing or invalid")
                    continue
                for key, value in conditions.items():
                    if key not in actual_conditions:
                        changed.append(f"{operator}.{key} missing in exact form")
                    elif actual_conditions[key] != value:
                        changed.append(f"{operator}.{key} value or type differs")
                if actual_conditions.keys() - conditions.keys():
                    changed.append(f"unexpected keys in Condition.{operator}")
        if "Sid" in observed:
            changed.append("Sid present")
        if observed.keys() - {*fields, "Sid"}:
            changed.append("unexpected fields")
        if changed:
            differences.append(f"expected rule {index + 1}: " + ", ".join(changed))
    return "; ".join(differences) if differences else "statement order"


def nonce_lifecycle_readback(rules):
    # The management API can return inactive protobuf fields on a rule.
    # Only discard known defaults; additional active filters/rules are drift.
    if not isinstance(rules, list) or len(rules) != 1 or not isinstance(rules[0], dict):
        return rules
    rule = rules[0].copy()
    defaults = {
        "transitions": ([], None),
        "abortIncompleteMultipartUpload": ({}, None),
        "noncurrentExpiration": ({}, None),
        "noncurrentTransitions": ([], None),
        "noncurrentDeleteMarkers": ({}, None),
    }
    for name, empty in defaults.items():
        if rule.get(name) in empty:
            rule.pop(name, None)
    rule_filter = rule.get("filter")
    if isinstance(rule_filter, dict):
        rule_filter = rule_filter.copy()
        for name in ("tag", "andOperator"):
            if rule_filter.get(name) in ({}, None):
                rule_filter.pop(name, None)
        for name in ("objectSizeGreaterThan", "objectSizeLessThan"):
            if rule_filter.get(name) == "":
                rule_filter.pop(name)
        rule["filter"] = rule_filter
    expiration = rule.get("expiration")
    if isinstance(expiration, dict):
        expiration = expiration.copy()
        if expiration.get("expiredObjectDeleteMarker") is False:
            expiration.pop("expiredObjectDeleteMarker")
        if expiration.get("date") == "":
            expiration.pop("date")
        if type(expiration.get("days")) is int:
            expiration["days"] = str(expiration["days"])
        rule["expiration"] = expiration
    return [rule]


def ensure_nonce_bucket(mode, folder, deploy_sa, runtime_sa, api, update_api, sleep, *, nonce_policy=None):
    settings, legacy_policy = nonce_bucket_contract(folder, runtime_sa)
    policy = legacy_policy if nonce_policy is None else nonce_policy
    bucket = settings["name"]

    def read(stage):
        try:
            current = api(f"{STORAGE}/{bucket}?view=VIEW_FULL", f"Read private nonce bucket ({stage})")
        except YandexHttpError as error:
            if error.status != 403:
                raise
            result = error.nonce_policy_readback
            if isinstance(result, dict):
                if result == policy:
                    result = "HTTP 200, policy matches the expected rules"
                elif result == legacy_policy:
                    result = "HTTP 200, only the previous runtime rule is present"
                else:
                    result = ("HTTP 200, policy differs from the expected rules ("
                              + nonce_policy_readback_diff(result, policy) + ")")
            probe = f" S3 GetBucketPolicy: {result}." if result is not None else ""
            raise WebHostingError(
                f"Read private nonce bucket ({stage}): HTTP 403 for {bucket}.{probe} "
                "Full bucket verification is required before rollout. "
                "If only the runtime rule is present, follow nonce bucket recovery in "
                "docs/operations/yandex-browser-telegram-login.md."
            ) from None
        flags = current.get("anonymousAccessFlags", {})
        website = current.get("websiteSettings")
        fields = [key for key in ("name", "folderId", "tags") if current.get(key) != settings[key]]
        if current.get("versioning", "VERSIONING_DISABLED") != "VERSIONING_DISABLED":
            fields.append("versioning")
        if not isinstance(flags, dict) or any(flags.get(key, False) is not False
                                             for key in settings["anonymousAccessFlags"]):
            fields.append("anonymousAccessFlags")
        empty_website = {"index": "", "error": "", "routingRules": [], "redirectAllRequests": {}}
        if website not in ({}, None) and (not isinstance(website, dict)
                or any(key not in empty_website or value not in (empty_website[key], None)
                       for key, value in website.items())):
            fields.append("websiteSettings")
        if current.get("cors") not in ([], None):
            fields.append("cors")
        if current.get("policy") not in ({}, None, legacy_policy, policy):
            fields.append("policy")
        lifecycle = current.get("lifecycleRules")
        lifecycle_missing = lifecycle in ([], None) and current.get("policy") in ({}, None)
        if not lifecycle_missing and nonce_lifecycle_readback(lifecycle) != settings["lifecycleRules"]:
            expected = settings["lifecycleRules"][0]
            same_rule = (isinstance(lifecycle, list) and len(lifecycle) == 1
                         and isinstance(lifecycle[0], dict) and lifecycle[0].get("id") == expected["id"]
                         and lifecycle[0].get("enabled") is True)
            if not fields and same_rule and api(
                    f"https://storage.yandexcloud.net/{bucket}?lifecycle",
                    "Verify effective nonce lifecycle through Object Storage S3 API").get("approved") is True:
                current = {**current, "lifecycleRules": settings["lifecycleRules"]}
            else:
                fields.append("lifecycleRules")
        if fields:
            raise WebHostingError("Nonce bucket differs from the approved private contract in: "
                                  + ", ".join(fields) + ".")
        direct = api(f"{STORAGE}/{bucket}:listAccessBindings", "Read nonce bucket IAM bindings")
        if direct.get("accessBindings") or direct.get("nextPageToken"):
            raise WebHostingError("Unexpected nonce bucket IAM bindings.")
        grants = current.get("acl", {}).get("grants", [])
        if any(grant.get("grantType") != "GRANT_TYPE_ACCOUNT"
               or grant.get("granteeId") != deploy_sa for grant in grants):
            raise WebHostingError("Unexpected nonce bucket ACL.")
        return current

    existing = choose(paged_list(api, STORAGE, folder, "buckets", "List nonce buckets"),
                      bucket, folder, "Private nonce bucket")
    current = read("preflight") if existing else {}
    policy_action = "reuse" if current.get("policy") == policy else "install"
    print(f"Nonce bucket: {'reuse' if existing else 'create'}; one-day expiry for empty markers; "
          f"policy: {policy_action}.", flush=True)
    if mode == "preview":
        return bucket
    if not existing:
        await_operation(api, api(STORAGE, "Create private nonce bucket", settings),
                        "Create private nonce bucket", sleep)
        current = read("after creation")
    if current.get("lifecycleRules") in ([], None):
        current = read("before lifecycle update")
        if current.get("lifecycleRules") in ([], None):
            await_operation(api, update_api(f"{STORAGE}/{bucket}", "Install missing nonce lifecycle", {
                "updateMask": "lifecycleRules", "lifecycleRules": settings["lifecycleRules"],
            }, method="PATCH"), "Install missing nonce lifecycle", sleep)
            current = read("after lifecycle update")
            if nonce_lifecycle_readback(current.get("lifecycleRules")) != settings["lifecycleRules"]:
                raise WebHostingError("Nonce bucket lifecycleRules failed readback.")
    if current.get("policy") != policy:
        fresh = read("before policy update")
        if nonce_lifecycle_readback(fresh.get("lifecycleRules")) != settings["lifecycleRules"]:
            raise WebHostingError("Nonce bucket lifecycleRules changed concurrently; run Preview again.")
        if fresh.get("policy") != current.get("policy"):
            raise WebHostingError("Nonce bucket policy changed concurrently; run Preview again.")
        update_api(f"https://storage.yandexcloud.net/{bucket}?policy", "Install exact nonce bucket policy",
                   policy, method="PUT")
        print("Nonce bucket policy submitted. Verifying deployed settings.", flush=True)
        if read("after policy update").get("policy") != policy:
            raise WebHostingError("Nonce bucket policy failed readback.")
    return bucket


def deploy_popup(mode, action, folder, gateway, function, deploy_sa, runtime_sa,
                 secret_id, secret_version, hosts, content, fingerprint, api, update_api, sleep, *, nonce_policy):
    function_id = function["id"]
    legacy_spec = browser_auth_gateway_spec(bucket_name(folder), function_id, deploy_sa)
    popup_spec = browser_auth_gateway_spec(bucket_name(folder), function_id, deploy_sa, popup=True)

    def current_gateway_spec():
        if not gateway_spec_changed(api, gateway, legacy_spec):
            return "legacy"
        if not gateway_spec_changed(api, gateway, popup_spec):
            return "popup"
        raise WebHostingError("Browser login gateway drift; refusing to overwrite routes.")

    versions = function_version_list(api, function_id)
    serving = select_tagged_version(versions)
    bucket = nonce_bucket_name(folder)
    version_args = (runtime_sa, secret_id, secret_version, hosts)

    def is_diagnostics(version):
        return any(version_matches(version, digest, *version_args, tagged=TAG in version.get("tags", []))
                   for digest in (DIAGNOSTICS_FINGERPRINT, fingerprint))

    def is_popup(version):
        return version_matches(version, fingerprint, *version_args,
                               tagged=TAG in version.get("tags", []), nonce_bucket=bucket)

    preserved = [version for version in versions if PRE_POPUP_TAG in version.get("tags", [])]
    if len(preserved) > 1 or (preserved and not is_diagnostics(preserved[0])):
        raise WebHostingError("Unexpected popup rollback version.")
    if not serving or not (is_diagnostics(serving) or (is_popup(serving) and preserved)):
        raise WebHostingError("Active version differs from approved diagnostics/popup code.")
    current_spec = current_gateway_spec()
    baseline = preserved[0] if preserved else serving
    if is_diagnostics(serving) and serving["id"] != baseline["id"]:
        raise WebHostingError("Serving diagnostics version differs from the rollback baseline.")

    def set_tag(version, tag):
        await_operation(api, api(f"{VERSIONS}/{version['id']}:setTag", "Set reviewed browser login tag",
                                 {"tag": tag}), "Set reviewed browser login tag", sleep)
        tagged = [v for v in function_version_list(api, function_id) if tag in v.get("tags", [])]
        if len(tagged) != 1 or tagged[0].get("id") != version["id"]:
            raise WebHostingError("Browser login tag failed readback.")

    def update_routes(spec):
        await_operation(api, update_api(f"{GATEWAYS}/{gateway['id']}", "Update popup methods only", {
            "updateMask": "openapiSpec", "openapiSpec": json.dumps(spec, separators=(",", ":")),
        }, method="PATCH"), "Update popup methods only", sleep)

    def ensure_serving(expected):
        active = select_tagged_version(function_version_list(api, function_id))
        if not active or active.get("id") != expected["id"]:
            raise WebHostingError("Serving function changed concurrently; rerun Preview.")

    if action == "popup-rollback":
        print("Restore the verified diagnostics version and remove the two popup POST methods.")
        if mode == "preview":
            return
        ensure_serving(serving)
        if current_gateway_spec() == "popup":
            update_routes(legacy_spec)
        if current_gateway_spec() != "legacy":
            raise WebHostingError("Legacy gateway routes failed readback.")
        ensure_serving(serving)
        if serving["id"] != baseline["id"]:
            set_tag(baseline, TAG)
        return

    candidates = [v for v in versions if v.get("description") == fingerprint and not is_diagnostics(v)]
    if len(candidates) > 1 or (candidates and not is_popup(candidates[0])):
        raise WebHostingError("Popup function candidate differs from the approved configuration.")
    print("Keep the verified diagnostics version and add only two popup POST methods.")
    ensure_nonce_bucket(mode, folder, deploy_sa, runtime_sa, api, update_api, sleep, nonce_policy=nonce_policy)
    if mode == "preview":
        return
    ensure_serving(serving)
    current_gateway_spec()
    if not preserved:
        set_tag(baseline, PRE_POPUP_TAG)
    if not candidates:
        payload = {"functionId": function_id, "runtime": "nodejs22", "entrypoint": "index.handler",
                   "resources": {"memory": "268435456"}, "executionTimeout": "20s",
                   "serviceAccountId": runtime_sa, "content": base64.b64encode(content).decode("ascii"),
                   "environment": {"MEZFIT_AUTH_HOSTS": hosts, "MEZFIT_BROWSER_CHALLENGE_BUCKET": bucket},
                   "tag": [], "description": fingerprint, "secrets": version_secrets(secret_id, secret_version)}
        result = await_operation(api, api(VERSIONS, "Publish private popup version", payload),
                                 "Publish private popup version", sleep)
        candidates = [v for v in function_version_list(api, function_id) if v.get("id") == result.get("id")]
        if len(candidates) != 1 or not is_popup(candidates[0]) or TAG in candidates[0].get("tags", []):
            raise WebHostingError("Popup version failed readback.")
    candidate = candidates[0]
    ensure_serving(serving)
    if serving["id"] != candidate["id"]:
        set_tag(candidate, TAG)
    if current_gateway_spec() == "legacy":
        update_routes(popup_spec)
    if current_gateway_spec() != "popup":
        raise WebHostingError("Popup gateway routes failed readback.")
    ensure_serving(candidate)


def execute(mode, action, confirm, folder, deploy_sa, runtime_sa, secret_id,
            secret_version, api, update_api, sleep=time.sleep, *, nonce_policy=None):
    require_confirmation(mode, action, confirm)
    if not resource_id(folder) or not resource_id(deploy_sa):
        raise WebHostingError("Missing YC_FOLDER_ID or YC_DEPLOY_SA_ID.")
    if mode == "apply" and not resource_id(runtime_sa):
        raise WebHostingError("Missing dedicated runtime service account.")

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
        if not resource_id(runtime_sa) or not resource_id(secret_id) or not resource_id(secret_version):
            if mode == "apply":
                raise WebHostingError("Configure dedicated runtime service account and pinned Yandex Lockbox secret ID + version ID before Apply.")
            print("PREVIEW: pinned Yandex Lockbox secret/version are not configured.")
        tagged = select_tagged_version(function_version_list(api, function["id"])) if function else None
        if tagged and (not resource_id(runtime_sa) or not resource_id(secret_id) or not resource_id(secret_version)
                       or not version_matches(tagged, fingerprint, runtime_sa, secret_id, secret_version, hosts)):
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
        if not has_gateway_invoker(bindings, deploy_sa):
            access_update = api(f"{FUNCTIONS}/{function['id']}:updateAccessBindings",
                                "Grant only gateway service account permission to invoke private function",
                                {"accessBindingDeltas": [{
                                    "action": "ADD", "accessBinding": {
                                        "roleId": "functions.functionInvoker",
                                        "subject": {"type": "serviceAccount", "id": deploy_sa},
                                    },
                                }]})
            await_operation(api, access_update, "Grant browser login function invoke access", sleep)
            if not has_gateway_invoker(function_bindings(api, function["id"]), deploy_sa):
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
                "serviceAccountId": runtime_sa,
                "content": base64.b64encode(content).decode("ascii"),
                "environment": {"MEZFIT_AUTH_HOSTS": hosts},
                "tag": [TAG],
                "description": fingerprint,
                "secrets": version_secrets(secret_id, secret_version),
            }
            await_operation(api, api(VERSIONS, "Publish signed browser-login function version", data),
                            "Publish browser login version", sleep)
            tagged = select_tagged_version(function_version_list(api, function["id"]))
            if not tagged or not version_matches(tagged, fingerprint, runtime_sa, secret_id, secret_version, hosts):
                raise WebHostingError("Browser login function version failed strict readback.")
        print(f"Browser auth function prepared: {function['id']}. Activate gateway routes separately.")
        return

    if not function:
        raise WebHostingError("Browser auth function absent; run Prepare first.")
    if not has_gateway_invoker(function_bindings(api, function["id"]), deploy_sa):
        raise WebHostingError("Existing private auth function does not grant invocation to the approved gateway SA.")
    tagged = select_tagged_version(function_version_list(api, function["id"]))
    if not resource_id(secret_id) or not resource_id(secret_version) or not tagged:
        raise WebHostingError("Expected pinned browser auth version is absent.")

    if action in {"popup", "popup-rollback"}:
        deploy_popup(mode, action, folder, gateway, function, deploy_sa, runtime_sa,
                     secret_id, secret_version, hosts, content, fingerprint, api, update_api, sleep,
                     nonce_policy=nonce_policy)
        return

    wanted = browser_auth_gateway_spec(bucket_name(folder), function["id"], deploy_sa)
    if action == "upgrade":
        if gateway_spec_changed(api, gateway, wanted):
            raise WebHostingError("Exact active auth gateway routes required before diagnostics upgrade.")
        if any(version_matches(tagged, digest, runtime_sa, secret_id, secret_version, hosts)
               for digest in (fingerprint, DIAGNOSTICS_FINGERPRINT)):
            old = [v for v in function_version_list(api, function["id"])
                   if PREVIOUS_TAG in v.get("tags", [])]
            if len(old) != 1 or not version_matches(
                    old[0], BASELINE_FINGERPRINT, runtime_sa, secret_id,
                    secret_version, hosts, tagged=False):
                raise WebHostingError("Diagnostic version active without validated rollback baseline.")
            print("Diagnostic browser auth version already active; no writes.")
            return
        if not version_matches(tagged, BASELINE_FINGERPRINT, runtime_sa,
                               secret_id, secret_version, hosts):
            raise WebHostingError("Serving browser auth version is not the approved baseline; manual review required.")
        versions = function_version_list(api, function["id"])
        tagged_previous = [v for v in versions if PREVIOUS_TAG in v.get("tags", [])]
        if len(tagged_previous) > 1 or (tagged_previous and tagged_previous[0].get("id") != tagged.get("id")):
            raise WebHostingError("Existing preserved baseline tag points elsewhere; manual review required.")
        candidate = [v for v in versions if v.get("description") == fingerprint
                     and TAG not in v.get("tags", [])]
        if len(candidate) > 1 or (candidate and not version_matches(
                candidate[0], fingerprint, runtime_sa, secret_id, secret_version, hosts,
                tagged=False)):
            raise WebHostingError("Existing untagged diagnostic version differs; manual review required.")
        print(f"Diagnostics upgrade: preserve approved baseline {tagged['id']}; "
              f"{'reuse' if candidate else 'publish'} diagnostic version; "
              f"source digest {fingerprint[-64:]}.")
        print("No gateway, secrets, cookies, Cloudflare, Dexie Cloud or media changes.")
        if mode == "preview":
            return

        # After validation, keep an explicit rollback reference before moving
        # the serving tag. An interrupted upgrade can resume without rotation.
        if PREVIOUS_TAG not in tagged.get("tags", []):
            op = api(f"{VERSIONS}/{tagged['id']}:setTag",
                     "Preserve approved browser login baseline for rollback",
                     {"tag": PREVIOUS_TAG})
            await_operation(api, op, "Preserve browser login baseline", sleep)
            versions = function_version_list(api, function["id"])
            preserved = [v for v in versions if v.get("id") == tagged["id"]]
            if len(preserved) != 1 or PREVIOUS_TAG not in preserved[0].get("tags", []):
                raise WebHostingError("Baseline rollback tag failed readback.")
        if not candidate:
            current_before_publish = select_tagged_version(function_version_list(api, function["id"]))
            if not current_before_publish or current_before_publish.get("id") != tagged["id"]:
                raise WebHostingError("Serving function changed concurrently; rerun Preview.")
            payload = {
                "functionId": function["id"],
                "runtime": "nodejs22",
                "entrypoint": "index.handler",
                "resources": {"memory": "268435456"},
                "executionTimeout": "20s",
                "serviceAccountId": runtime_sa,
                "content": base64.b64encode(content).decode("ascii"),
                "environment": {"MEZFIT_AUTH_HOSTS": hosts},
                "tag": [],  # Publish without moving the serving browser-login tag.
                "description": fingerprint,
                "secrets": version_secrets(secret_id, secret_version),
            }
            result = await_operation(api, api(VERSIONS, "Publish untagged diagnostics version", payload),
                                     "Publish diagnostics version", sleep)
            versions = function_version_list(api, function["id"])
            candidate = [v for v in versions if v.get("id") == result.get("id")]
            if len(candidate) != 1 or not version_matches(
                    candidate[0], fingerprint, runtime_sa, secret_id, secret_version, hosts,
                    tagged=False):
                raise WebHostingError("Untagged diagnostic version failed strict readback.")
        current = select_tagged_version(function_version_list(api, function["id"]))
        if not current or current.get("id") != tagged["id"]:
            raise WebHostingError("Serving function changed concurrently; rerun Preview.")
        op = api(f"{VERSIONS}/{candidate[0]['id']}:setTag",
                 "Activate reviewed diagnostics function version", {"tag": TAG})
        await_operation(api, op, "Activate diagnostics version", sleep)
        after_versions = function_version_list(api, function["id"])
        activated = select_tagged_version(after_versions)
        previous = [v for v in after_versions if v.get("id") == tagged["id"]]
        if (not activated or activated.get("id") != candidate[0]["id"]
                or not version_matches(activated, fingerprint, runtime_sa,
                                       secret_id, secret_version, hosts)
                or len(previous) != 1 or PREVIOUS_TAG not in previous[0].get("tags", [])
                or gateway_spec_changed(api, gateway, wanted)):
            raise WebHostingError("Diagnostic deployment or rollback reference failed readback.")
        print("Safe OIDC diagnostics active; previous function code retained under rollback tag.")
        return

    if not any(version_matches(tagged, digest, runtime_sa, secret_id, secret_version, hosts)
               for digest in (fingerprint, DIAGNOSTICS_FINGERPRINT)):
        raise WebHostingError("Expected ACTIVE tagged browser auth version with pinned Lockbox secrets is absent.")

    wanted = browser_auth_gateway_spec(bucket_name(folder), function["id"], deploy_sa)
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
    # Resolve and, only in owner-confirmed Prepare Apply, create the
    # dedicated runtime SA and protected Lockbox secret using GitHub Secrets.
    # No secret payload, signing key or Telegram Client Secret is printed.
    from browser_auth_bootstrap import bootstrap
    mode = os.environ.get("MODE", "")
    action = os.environ.get("ACTION", "")
    confirm = os.environ.get("CONFIRM", "")
    require_confirmation(mode, action, confirm)
    folder = os.environ.get("YC_FOLDER_ID", "")
    if not resource_id(folder):
        raise WebHostingError("Missing approved YC_FOLDER_ID.")
    # Avoid even partial IAM/Lockbox creation if the original website
    # gateway is absent or already differs from the approved contract.
    if mode == "apply" and action == "prepare":
        current_gateway = choose(
            paged_list(api, GATEWAYS, folder, "apiGateways", "Preflight browser auth Gateway"),
            NAME_GATEWAY, folder, "Existing SPA gateway")
        check_gateway(current_gateway, api, folder)
    bootstrap_action = "upgrade" if action in {"popup", "popup-rollback"} else action
    runtime_sa, secret_id, version_id = bootstrap(mode, bootstrap_action, folder, api)
    deploy_sa = os.environ.get("YC_DEPLOY_SA_ID", "")
    nonce_policy = deploy_nonce_bucket_policy(folder, deploy_sa, runtime_sa) if action == "popup" else None
    execute(mode, action, confirm, folder, deploy_sa, runtime_sa, secret_id, version_id, api, update_api,
            nonce_policy=nonce_policy)


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
