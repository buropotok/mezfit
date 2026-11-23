"""Yandex Cloud web foundation for MezFit: scoped Preview / Apply only.

Creates a public-read static asset bucket, an API Gateway, and a managed TLS
certificate request. Does NOT change DNS/NS, attach a custom domain, or upload
an application. Reuses only the existing federated Yandex IAM token.
"""

import json
from copy import deepcopy
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

STORAGE = "https://storage.api.cloud.yandex.net/storage/v1/buckets"
GATEWAYS = "https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways"
CERTIFICATES = "https://certificate-manager.api.cloud.yandex.net/certificate-manager/v1/certificates"
OPERATIONS = "https://operation.api.cloud.yandex.net/operations"
NAME_GATEWAY = "mezfit-web"
NAME_CERTIFICATE = "mezfit-ru-web"
DOMAIN = "mezfit.ru"
CONFIRMATION = "PREPARE_MEZFIT_WEB"
SAFE_FLAGS = {"read": True, "list": False, "configRead": False}


class WebHostingError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def resource_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[a-z0-9]+", value))


def bucket_name(folder_id):
    return f"mezfit-web-{folder_id}"


def request_json(opener, token, url, label, payload=None):
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=data,
        method="POST" if payload is not None else "GET",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise WebHostingError(f"{label}: HTTP {error.code}; check scoped Yandex IAM roles and resource state.") from None
    except (URLError, OSError, ValueError):
        raise WebHostingError(f"{label}: invalid/unavailable Yandex API response.") from None
    if not isinstance(result, dict):
        raise WebHostingError(f"{label}: expected a JSON object.")
    return result


def paged_list(api, base_url, folder_id, key, label):
    items = []
    token = ""
    seen = set()
    for _ in range(100):
        params = {"folderId": folder_id, "pageSize": "1000"}
        if token:
            params["pageToken"] = token
        page = api(f"{base_url}?{urlencode(params)}", label)
        batch = page.get(key, [])
        if not isinstance(batch, list) or not all(isinstance(item, dict) for item in batch):
            raise WebHostingError(f"{label}: malformed items.")
        items.extend(batch)
        token = page.get("nextPageToken", "")
        if not isinstance(token, str):
            raise WebHostingError(f"{label}: malformed page token.")
        if not token:
            return items
        if token in seen:
            raise WebHostingError(f"{label}: pagination loop.")
        seen.add(token)
    raise WebHostingError(f"{label}: pagination safety limit.")


def gateway_spec(bucket):
    """A stable exact OpenAPI contract, safe for adding /api backend routes later."""
    def file_route(key, *, fallback=False):
        integration = {"type": "object_storage", "bucket": bucket, "object": key}
        if fallback:
            integration["error_object"] = {"object": "index.html", "statusCode": 200}
        return {"get": {"x-yc-apigateway-integration": integration}}

    # Until backend migration, /api must not silently return SPA index.html.
    unavailable = {
        "x-yc-apigateway-integration": {
            "type": "dummy",
            "http_code": 503,
            "http_headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "content": {"*": '{"error":"backend_not_migrated"}'},
        },
    }
    methods = ("get", "post", "put", "patch", "delete", "options")
    return {
        "openapi": "3.0.0",
        "info": {"title": "MezFit Yandex Web Foundation", "version": "1.0.0"},
        "paths": {
            "/": file_route("index.html"),
            "/assets/{file+}": {
                "get": {
                    "parameters": [{"name": "file", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "x-yc-apigateway-integration": {
                        "type": "object_storage", "bucket": bucket, "object": "assets/{file}",
                    },
                },
            },
            "/api": {method: unavailable for method in methods},
            "/api/{proxy+}": {
                method: {
                    "parameters": [
                        {"name": "proxy", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    **unavailable,
                }
                for method in methods
            },
            "/{file+}": {
                "get": {
                    "parameters": [{"name": "file", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "x-yc-apigateway-integration": {
                        "type": "object_storage", "bucket": bucket, "object": "{file}",
                        "error_object": {"object": "index.html", "statusCode": 200},
                    },
                },
            },
        },
    }


def choose(items, expected_name, folder_id, label):
    matches = [item for item in items if item.get("name") == expected_name]
    if len(matches) > 1:
        raise WebHostingError(f"{label}: duplicate name in target folder.")
    if not matches:
        return None
    item = matches[0]
    if item.get("folderId") != folder_id:
        raise WebHostingError(f"{label}: wrong folder.")
    return item


def verify_bucket(bucket, folder_id):
    if (bucket.get("name") != bucket_name(folder_id)
            or bucket.get("folderId") != folder_id
            or bucket.get("anonymousAccessFlags") != SAFE_FLAGS):
        raise WebHostingError("Unexpected website bucket name, ownership, or public-access settings.")
    return bucket


def verify_certificate(cert, folder_id):
    if (cert.get("folderId") != folder_id or cert.get("name") != NAME_CERTIFICATE
            or cert.get("domains") != [DOMAIN]
            or cert.get("type") not in {"MANAGED", "CERTIFICATE_TYPE_MANAGED"}
            or cert.get("deletionProtection") is not True
            or not resource_id(cert.get("id"))):
        raise WebHostingError("Existing TLS certificate differs from the expected managed mezfit.ru request.")
    return cert


def normalize_gateway_readback(spec, domain):
    """Discard only known OpenAPI display/default fields; preserve executable policy.

    Yandex may enrich the stored spec with its default public server, operation
    descriptions/responses, and standard path-parameter defaults. In contrast,
    the integration, path/method set, auth, bucket and fallback must match.
    """
    if not isinstance(spec, dict):
        raise WebHostingError("Gateway specification must be an OpenAPI object.")
    normalized = deepcopy(spec)
    servers = normalized.pop("servers", None)
    if servers is not None:
        # Never treat an arbitrary host as benign normalization.
        expected_url = f"https://{domain}" if isinstance(domain, str) and domain else ""
        if (not expected_url or not isinstance(servers, list) or not servers
                or any(not isinstance(server, dict)
                       or set(server) - {"url", "description"}
                       or not isinstance(server.get("url"), str)
                       or server["url"].rstrip("/") != expected_url
                       for server in servers)):
            raise WebHostingError("Gateway specification has an unexpected server URL.")

    paths = normalized.get("paths")
    if isinstance(paths, dict):
        for route in paths.values():
            if not isinstance(route, dict):
                continue
            for operation in route.values():
                if not isinstance(operation, dict):
                    continue
                for field in ("operationId", "summary", "description", "responses", "tags"):
                    operation.pop(field, None)
                # The default in OpenAPI for a path parameter is simple / no explode.
                params = operation.get("parameters")
                if isinstance(params, list):
                    for param in params:
                        if not isinstance(param, dict) or param.get("in") != "path":
                            continue
                        if param.get("style") == "simple":
                            param.pop("style")
                        if param.get("explode") is False:
                            param.pop("explode")
                        schema = param.get("schema")
                        if isinstance(schema, dict) and schema.get("style") == "simple":
                            schema.pop("style")
                integration = operation.get("x-yc-apigateway-integration")
                if isinstance(integration, dict) and isinstance(integration.get("http_headers"), dict):
                    headers = integration["http_headers"]
                    if len(headers) != len({key.lower() for key in headers if isinstance(key, str)}):
                        raise WebHostingError("Gateway integration contains duplicate HTTP header names.")
                    integration["http_headers"] = {key.lower(): value for key, value in headers.items()}
    return normalized


def spec_diff_paths(expected, actual, path="$", limit=8):
    """Report safe JSON field paths, never potentially sensitive field values."""
    if type(expected) is not type(actual):
        return [path]
    if isinstance(expected, dict):
        result = []
        for key in sorted(set(expected) | set(actual)):
            field_path = f"{path}.{key}"
            if key not in expected or key not in actual:
                result.append(field_path)
            else:
                result.extend(spec_diff_paths(expected[key], actual[key], field_path, limit))
            if len(result) >= limit:
                return result[:limit]
        return result
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return [path]
        result = []
        for index, (wanted, found) in enumerate(zip(expected, actual)):
            result.extend(spec_diff_paths(wanted, found, f"{path}[{index}]", limit))
            if len(result) >= limit:
                return result[:limit]
        return result
    return [] if expected == actual else [path]


def verify_gateway(gateway, folder_id, bucket, api):
    if (gateway.get("folderId") != folder_id or gateway.get("name") != NAME_GATEWAY
            or not resource_id(gateway.get("id"))
            or gateway.get("status") not in {"ACTIVE", "CREATING", "UPDATING"}):
        raise WebHostingError("Existing gateway has unexpected owner, name or status.")

    # Domains may now be attached independently; publishing must still verify
    # that no other domain/certificate or gateway integration was introduced.
    attached = gateway.get("attachedDomains")
    if attached is None:
        attached = []
    if not isinstance(attached, list) or len(attached) > 2:
        raise WebHostingError("Unexpected gateway custom-domain attachments.")
    if attached:
        approved_names = {"mezfit.ru": NAME_CERTIFICATE,
                          "mezfit.online": "mezfit-online-web"}
        known = paged_list(api, CERTIFICATES, folder_id, "certificates", "List approved domain certificates")
        used = set()
        for item in attached:
            if not isinstance(item, dict) or not isinstance(item.get("domain"), str):
                raise WebHostingError("Malformed attached domain.")
            name = item["domain"].rstrip(".")
            expected_name = approved_names.get(name)
            matches = [c for c in known if c.get("name") == expected_name] if expected_name else []
            if (name in used or len(matches) != 1 or item.get("certificateId") != matches[0].get("id")
                    or item.get("enabled") is not True
                    or matches[0].get("status") not in {"ISSUED", "RENEWING"}
                    or matches[0].get("folderId") != folder_id
                    or matches[0].get("domains") != [name]
                    or matches[0].get("type") != "MANAGED"
                    or matches[0].get("deletionProtection") is not True):
                raise WebHostingError("Unexpected gateway domain or certificate binding.")
            used.add(name)
    result = api(f"{GATEWAYS}/{gateway['id']}:spec", "Read gateway OpenAPI contract")
    try:
        actual = json.loads(result["openapiSpec"])
    except (KeyError, TypeError, ValueError):
        raise WebHostingError("Cannot parse current gateway specification.") from None
    expected = normalize_gateway_readback(gateway_spec(bucket), gateway.get("domain"))
    actual = normalize_gateway_readback(actual, gateway.get("domain"))
    differences = spec_diff_paths(expected, actual)
    if differences:
        raise WebHostingError(
            "Existing gateway specification differs at "
            + ", ".join(differences)
            + "; refusing to overwrite or reuse modified routes."
        )
    return gateway


def await_operation(api, operation, label, sleep=time.sleep):
    operation_id = operation.get("id")
    if not resource_id(operation_id):
        raise WebHostingError(f"{label}: missing Yandex operation ID.")
    print(f"{label}: operation {operation_id}", flush=True)
    for _ in range(70):
        if operation.get("done") is True:
            if operation.get("error") or not isinstance(operation.get("response"), dict):
                raise WebHostingError(f"{label}: creation failed; inspect operation {operation_id}.")
            return operation["response"]
        sleep(3)
        operation = api(f"{OPERATIONS}/{operation_id}", f"Poll {label}")
    raise WebHostingError(f"{label}: operation still pending; inspect operation {operation_id} before retry.")


def inspect(api, folder_id):
    bucket = choose(paged_list(api, STORAGE, folder_id, "buckets", "List website buckets"),
                    bucket_name(folder_id), folder_id, "Website bucket")
    gateway = choose(paged_list(api, GATEWAYS, folder_id, "apiGateways", "List API gateways"),
                     NAME_GATEWAY, folder_id, "Website gateway")
    certificate = choose(paged_list(api, CERTIFICATES, folder_id, "certificates", "List TLS certificates"),
                         NAME_CERTIFICATE, folder_id, "Website certificate")
    if bucket:
        verify_bucket(bucket, folder_id)
    if gateway:
        verify_gateway(gateway, folder_id, bucket_name(folder_id), api)
    if certificate:
        verify_certificate(certificate, folder_id)
    return bucket, gateway, certificate


def certificate_challenge(api, cert_id):
    detail = api(f"{CERTIFICATES}/{cert_id}?view=FULL", "Read TLS validation challenge")
    cname = [
        entry.get("dnsChallenge") for entry in detail.get("challenges", [])
        if isinstance(entry, dict) and isinstance(entry.get("dnsChallenge"), dict)
        and entry["dnsChallenge"].get("type") in {"CNAME", "DNS_CNAME"}
    ]
    for record in cname:
        name = record.get("name")
        value = record.get("value")
        if isinstance(name, str) and isinstance(value, str) and name and value:
            print(f"Certificate validation CNAME: {name} -> {value}")
    if detail.get("status") != "ISSUED":
        print("Certificate is not yet issued: publish CNAME at the CURRENT authoritative DNS "
              "(REG.RU while NS is not delegated). This workflow does not update DNS.")


def execute(mode, confirmation, folder_id, api, sleep=time.sleep):
    if mode not in ("preview", "apply"):
        raise WebHostingError("Only preview and apply are supported.")
    if not resource_id(folder_id):
        raise WebHostingError("Missing/invalid YC_FOLDER_ID.")
    if mode == "apply" and confirmation != CONFIRMATION:
        raise WebHostingError("Apply requires the exact manual confirmation.")

    bucket, gateway, certificate = inspect(api, folder_id)
    print(f"Target folder: {folder_id}; bucket: {bucket_name(folder_id)}; "
          f"gateway: {NAME_GATEWAY}; certificate: {NAME_CERTIFICATE}.")
    print(f"Plan: bucket={'reuse' if bucket else 'create'}, "
          f"gateway={'reuse' if gateway else 'create'}, "
          f"certificate={'reuse' if certificate else 'request'}.")

    if mode == "preview":
        print("PREVIEW: no resource writes, SPA uploads, DNS/NS changes, or certificate bindings.")
        return

    # Preflight again immediately before writes. Fail closed on any conflicts.
    bucket, gateway, certificate = inspect(api, folder_id)
    if not bucket:
        response = await_operation(api, api(STORAGE, "Create public-read website assets bucket", {
            "folderId": folder_id, "name": bucket_name(folder_id),
            "anonymousAccessFlags": SAFE_FLAGS, "defaultStorageClass": "STANDARD",
        }), "Website bucket", sleep)
        if response.get("name") != bucket_name(folder_id):
            raise WebHostingError("Bucket create response does not match expected name.")
        bucket = choose(paged_list(api, STORAGE, folder_id, "buckets", "Verify website bucket"),
                        bucket_name(folder_id), folder_id, "Website bucket")
        if not bucket:
            raise WebHostingError("New bucket not visible in folder; inspect Yandex resources.")
        verify_bucket(bucket, folder_id)

    if not gateway:
        contract = json.dumps(gateway_spec(bucket_name(folder_id)), separators=(",", ":"))
        response = await_operation(api, api(GATEWAYS, "Create web API Gateway", {
            "folderId": folder_id, "name": NAME_GATEWAY,
            "description": "MezFit public SPA foundation; API intentionally unavailable until Yandex backend migration",
            "openapiSpec": contract,
        }), "Web gateway", sleep)
        if not resource_id(response.get("id")):
            raise WebHostingError("Gateway creation response does not contain a valid ID.")
        gateway = choose(paged_list(api, GATEWAYS, folder_id, "apiGateways", "Verify web gateway"),
                         NAME_GATEWAY, folder_id, "Website gateway")
        if not gateway or gateway.get("id") != response["id"]:
            raise WebHostingError("New gateway missing or ambiguous in folder.")
        verify_gateway(gateway, folder_id, bucket_name(folder_id), api)

    if not certificate:
        response = await_operation(api, api(f"{CERTIFICATES}/requestNew", "Request managed mezfit.ru TLS", {
            "folderId": folder_id, "name": NAME_CERTIFICATE,
            "domains": [DOMAIN], "challengeType": "DNS",
            "deletionProtection": True,
            "description": "MezFit website; domain ownership verification is performed separately",
        }), "TLS request", sleep)
        if not resource_id(response.get("id")):
            raise WebHostingError("Certificate request response does not contain a valid ID.")
        certificate = choose(paged_list(api, CERTIFICATES, folder_id, "certificates", "Verify TLS certificate"),
                             NAME_CERTIFICATE, folder_id, "Website certificate")
        if not certificate or certificate.get("id") != response["id"]:
            raise WebHostingError("TLS certificate missing or ambiguous in folder.")
        verify_certificate(certificate, folder_id)

    final_bucket, final_gateway, final_cert = inspect(api, folder_id)
    if not all((final_bucket, final_gateway, final_cert)):
        raise WebHostingError("Final readback incomplete; inspect Yandex before retry.")
    print(f"Gateway default domain: https://{final_gateway.get('domain', '(not available)')}")
    certificate_challenge(api, final_cert["id"])
    print("Yandex web foundation verified. No application upload, custom-domain binding or DNS mutation.")


def main():
    token = os.environ.get("YC_IAM_TOKEN")
    if not token:
        raise WebHostingError("Missing Yandex IAM token.")
    opener = build_opener(NoRedirect())
    def api(url, label, payload=None):
        return request_json(opener, token, url, label, payload)

    execute(os.environ.get("MODE", ""), os.environ.get("CONFIRM", ""),
            os.environ.get("YC_FOLDER_ID", ""), api)


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
