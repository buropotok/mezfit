"""Read-only preview and explicitly approved creation of the mezfit.ru public DNS zone.

Only DNS zone creation is in scope. No NS delegation or record updates.
Uses the existing GitHub -> Yandex OIDC IAM token; no static credentials.
"""

import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

DNS_API = "https://dns.api.cloud.yandex.net/dns/v1/zones"
OPERATIONS_API = "https://operation.api.cloud.yandex.net/operations"
ZONE_NAME = "mezfit-ru"
ZONE_SUFFIX = "mezfit.ru."
APPLY_CONFIRMATION = "CREATE_MEZFIT_RU_DNS"


class DnsSetupError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def resource_id(value):
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9]+", value) is not None


def request_json(opener, token, url, label, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        raise DnsSetupError(f"{label}: HTTP {error.code}. Check DNS permissions and operation status.") from None
    except (URLError, OSError, ValueError):
        raise DnsSetupError(f"{label}: Yandex API response unavailable or invalid.") from None
    if not isinstance(result, dict):
        raise DnsSetupError(f"{label}: expected a JSON object.")
    return result


def list_zones(folder_id, api):
    """Inspect every page; absence on page one is not proof of absence."""
    zones = []
    page_token = ""
    seen_tokens = set()
    for _ in range(100):
        query = {"folderId": folder_id, "pageSize": "1000"}
        if page_token:
            query["pageToken"] = page_token
        response = api(f"{DNS_API}?{urlencode(query)}", "List DNS zones")
        batch = response.get("dnsZones", [])
        if not isinstance(batch, list) or not all(isinstance(zone, dict) for zone in batch):
            raise DnsSetupError("DNS zone list has an invalid shape.")
        zones.extend(batch)
        next_token = response.get("nextPageToken", "")
        if not isinstance(next_token, str):
            raise DnsSetupError("DNS pagination token is invalid.")
        if not next_token:
            return zones
        if next_token in seen_tokens:
            raise DnsSetupError("DNS pagination loop detected; refusing to create a zone.")
        seen_tokens.add(next_token)
        page_token = next_token
    raise DnsSetupError("DNS zone list exceeded the pagination safety limit.")


def matching_zone(zones, folder_id):
    """Never adopt a private zone, a conflicting suffix, or an ambiguous match."""
    candidates = [
        zone for zone in zones
        if zone.get("name") == ZONE_NAME or zone.get("zone") == ZONE_SUFFIX
    ]
    if not candidates:
        return None
    if len(candidates) != 1:
        raise DnsSetupError("Multiple DNS zones match the expected name or suffix; manual review required.")
    zone = candidates[0]
    if (zone.get("name") != ZONE_NAME or zone.get("zone") != ZONE_SUFFIX
            or zone.get("folderId") != folder_id
            or "publicVisibility" not in zone or not isinstance(zone["publicVisibility"], dict)
            or "privateVisibility" in zone or not resource_id(zone.get("id"))):
        raise DnsSetupError("Existing DNS zone conflicts with the expected public mezfit.ru configuration.")
    return zone


def wait_for_creation(operation, api, sleep):
    operation_id = operation.get("id")
    if not resource_id(operation_id):
        raise DnsSetupError("Yandex returned an invalid DNS creation operation ID.")
    print(f"Yandex create operation: {operation_id}", flush=True)
    for _ in range(60):
        if operation.get("done") is True:
            if operation.get("error") or not isinstance(operation.get("response"), dict):
                raise DnsSetupError("DNS creation operation failed; inspect it in Yandex Cloud.")
            zone_id = operation["response"].get("id")
            if not resource_id(zone_id):
                raise DnsSetupError("DNS creation response lacks a valid zone ID.")
            return zone_id
        sleep(3)
        operation = api(f"{OPERATIONS_API}/{operation_id}", "Check DNS creation operation")
    raise DnsSetupError("DNS creation is still pending. Inspect the operation before retrying.")


def execute(mode, confirmation, folder_id, api, sleep=time.sleep):
    if mode not in {"preview", "apply"}:
        raise DnsSetupError("Mode must be preview or apply.")
    if not resource_id(folder_id):
        raise DnsSetupError("YC_FOLDER_ID is missing or malformed.")
    if mode == "apply" and confirmation != APPLY_CONFIRMATION:
        raise DnsSetupError("Apply requires the exact manual confirmation.")

    current = matching_zone(list_zones(folder_id, api), folder_id)
    if current:
        print(f"Public DNS zone already exists: {current['id']} ({ZONE_SUFFIX}); no changes.")
        if current.get("deletionProtection") is not True:
            print("NOTE: Existing zone has no verified deletion protection; this workflow will not modify it.")
        return

    print(f"DNS plan: create PUBLIC zone {ZONE_NAME} / {ZONE_SUFFIX} in folder {folder_id}.")
    print("NS delegation at REG.RU and DNS record changes are explicitly out of scope.")
    if mode == "preview":
        print("PREVIEW ONLY: zero mutations performed.")
        return

    # Re-read immediately before the write. Name collisions are rejected by Yandex as well.
    current = matching_zone(list_zones(folder_id, api), folder_id)
    if current:
        print(f"Public DNS zone appeared before Apply: {current['id']}; no changes.")
        return

    operation = api(DNS_API, "Create public DNS zone", {
        "folderId": folder_id,
        "name": ZONE_NAME,
        "zone": ZONE_SUFFIX,
        "publicVisibility": {},
        "deletionProtection": True,
        "description": "MezFit DNS foundation; registrar NS delegation is a separate owner action.",
    })
    zone_id = wait_for_creation(operation, api, sleep)
    published = api(f"{DNS_API}/{zone_id}", "Read created DNS zone")
    verified = matching_zone([published], folder_id)
    if not verified or verified["id"] != zone_id or verified.get("deletionProtection") is not True:
        raise DnsSetupError("DNS zone readback does not match requested public protected configuration.")
    final = matching_zone(list_zones(folder_id, api), folder_id)
    if not final or final["id"] != zone_id:
        raise DnsSetupError("DNS zone list readback differs from the created zone.")
    print(f"Verified public protected DNS zone: {zone_id}. No registrar changes were made.")


def main():
    token = os.environ.get("YC_IAM_TOKEN")
    if not token:
        raise DnsSetupError("Missing short-lived Yandex IAM token.")
    opener = build_opener(NoRedirect())

    def api(url, label, payload=None):
        return request_json(opener, token, url, label, payload)

    execute(
        os.environ.get("MODE", ""),
        os.environ.get("CONFIRM", ""),
        os.environ.get("YC_FOLDER_ID", ""),
        api,
    )


if __name__ == "__main__":
    try:
        main()
    except DnsSetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
