"""Owner-gated staging of mezfit.online and mezfit.ru on one Yandex API Gateway.

All operations are additive and idempotent. No registrar, Telegram or backend
configuration is changed. Activate is a separate explicitly confirmed cutover.
"""

import os
import sys
from urllib.parse import urlencode

from web_hosting import (
    CERTIFICATES, GATEWAYS, NoRedirect, WebHostingError,
    await_operation, bucket_name, choose, paged_list, request_json, resource_id,
    verify_gateway,
)
from urllib.request import build_opener

DNS = "https://dns.api.cloud.yandex.net/dns/v1/zones"
DOMAINS = {
    "mezfit.online": {"zone_name": "mezfit-online", "cert_name": "mezfit-online-web"},
    "mezfit.ru": {"zone_name": "mezfit-ru", "cert_name": "mezfit-ru-web"},
}
ACTIONS = ("prepare_online", "validate_online", "validate_ru", "activate_online", "activate_ru")


def target(action):
    return "mezfit.online" if action.endswith("online") else "mezfit.ru"


def select_zone(api, folder, domain):
    zones = paged_list(api, DNS, folder, "dnsZones", "List DNS zones")
    spec = DOMAINS[domain]
    matches = [z for z in zones if z.get("name") == spec["zone_name"]
               or z.get("zone") == domain + "."]
    if len(matches) > 1:
        raise WebHostingError(f"Ambiguous {domain} DNS zone; manual review required.")
    if not matches:
        return None
    zone = matches[0]
    if (zone.get("name") != spec["zone_name"]
            or zone.get("zone") != domain + "."
            or zone.get("folderId") != folder
            or not isinstance(zone.get("publicVisibility"), dict)
            or "privateVisibility" in zone
            or zone.get("deletionProtection") is not True
            or not resource_id(zone.get("id"))):
        raise WebHostingError(f"Existing DNS zone conflicts with the protected public {domain} zone.")
    return zone


def select_certificate(api, folder, domain):
    certificates = paged_list(api, CERTIFICATES, folder, "certificates", "List managed certificates")
    name = DOMAINS[domain]["cert_name"]
    matches = [cert for cert in certificates if cert.get("name") == name]
    if len(matches) > 1:
        raise WebHostingError(f"Duplicate {domain} certificate names.")
    if not matches:
        return None
    cert = matches[0]
    if (cert.get("name") != name or cert.get("folderId") != folder
            or cert.get("domains") != [domain]
            or cert.get("type") != "MANAGED"
            or cert.get("deletionProtection") is not True
            or not resource_id(cert.get("id"))):
        raise WebHostingError(f"Unexpected {domain} TLS certificate.")
    return cert


def get_gateway(api, folder):
    gateway = choose(paged_list(api, GATEWAYS, folder, "apiGateways", "List API gateways"),
                     "mezfit-web", folder, "MezFit API Gateway")
    if not gateway:
        raise WebHostingError("Original MezFit API Gateway not found; do not create another.")
    verify_gateway(gateway, folder, bucket_name(folder), api)
    if gateway.get("status") != "ACTIVE":
        raise WebHostingError("API Gateway must be ACTIVE before attaching a domain.")
    domain = gateway.get("domain", "")
    if (not isinstance(domain, str) or not domain.endswith(".apigw.yandexcloud.net")
            or not resource_id(gateway.get("id"))):
        raise WebHostingError("Unexpected default gateway hostname.")
    return gateway


def list_records(api, zone_id):
    records = []
    page_token = ""
    seen = set()
    for _ in range(100):
        params = {"pageSize": "1000"}
        if page_token:
            params["pageToken"] = page_token
        page = api(f"{DNS}/{zone_id}:listRecordSets?{urlencode(params)}",
                   "List DNS record sets")
        batch = page.get("recordSets", [])
        if not isinstance(batch, list) or not all(isinstance(item, dict) for item in batch):
            raise WebHostingError("Invalid DNS record-set response.")
        records.extend(batch)
        page_token = page.get("nextPageToken", "")
        if not isinstance(page_token, str) or page_token in seen:
            raise WebHostingError("Invalid DNS record pagination.")
        if not page_token:
            return records
        seen.add(page_token)
    raise WebHostingError("DNS record pagination limit exceeded.")


def check_record(records, name, kind, value):
    """Return true if identical record exists, false if absent. Never replace."""
    matches = [record for record in records if record.get("name") == name]
    typed = [record for record in matches if record.get("type") == kind]
    if len(typed) > 1:
        raise WebHostingError(f"Duplicate {kind} record at {name}; manual review.")
    # A CNAME must not coexist with any other type. ANAME at zone apex must
    # not collide with records carrying an address or an alias.
    incompatible = (lambda r: r.get("type") != kind) if kind == "CNAME" else (
        lambda r: r.get("type") in {"A", "AAAA", "CNAME"})
    if any(incompatible(record) for record in matches):
        raise WebHostingError(f"Conflicting DNS record type at {name}; manual review.")
    if typed:
        if typed[0].get("data") != [value]:
            raise WebHostingError(f"Conflicting {kind} record at {name}; manual review.")
        return True
    return False


def dns_challenge(api, certificate, domain):
    if certificate.get("status") in {"ISSUED", "RENEWING"}:
        return None
    if certificate.get("status") != "VALIDATING":
        raise WebHostingError(f"{domain} certificate is not awaiting validation; inspect its status.")
    detail = api(f"{CERTIFICATES}/{certificate['id']}?view=FULL",
                 f"Read {domain} certificate validation challenge")
    if detail.get("id") != certificate["id"] or detail.get("domains") != [domain]:
        raise WebHostingError("Certificate detail differs from approved managed certificate.")
    candidates = [
        c["dnsChallenge"] for c in detail.get("challenges", [])
        if isinstance(c, dict)
        and isinstance(c.get("dnsChallenge"), dict)
        and c["dnsChallenge"].get("type") == "CNAME"
        and c.get("domain") in (None, domain)
    ]
    if len(candidates) != 1:
        raise WebHostingError(f"{domain} must have exactly one DNS CNAME validation challenge.")
    record = candidates[0]
    if (record.get("name") != f"_acme-challenge.{domain}."
            or not isinstance(record.get("value"), str)
            or not record["value"].endswith(".")):
        raise WebHostingError(f"Invalid {domain} DNS challenge; do not write DNS.")
    return {"name": record["name"], "type": "CNAME", "ttl": "300",
            "data": [record["value"]]}


def attached_to(gateway, domain, cert):
    candidates = [
        attached for attached in (gateway.get("attachedDomains") or [])
        if isinstance(attached, dict) and attached.get("domain", "").rstrip(".") == domain
    ]
    if len(candidates) > 1:
        raise WebHostingError("Duplicate domain attached to API Gateway.")
    if not candidates:
        return False
    item = candidates[0]
    if item.get("certificateId") != cert["id"] or item.get("enabled") is not True:
        raise WebHostingError("Existing gateway domain attachment uses wrong certificate or is disabled.")
    return True


def apply_record(api, zone, record, label, sleep):
    result = api(f"{DNS}/{zone['id']}:updateRecordSets", label,
                 {"additions": [record], "deletions": []})
    await_operation(api, result, label, sleep)
    current = list_records(api, zone["id"])
    if not check_record(current, record["name"], record["type"], record["data"][0]):
        raise WebHostingError(f"{label} was not confirmed by DNS readback.")


def execute(mode, action, folder, api, sleep=None):
    if mode not in {"preview", "apply"} or action not in ACTIONS:
        raise WebHostingError("Choose known action and preview/apply mode.")
    if not resource_id(folder):
        raise WebHostingError("Invalid YC_FOLDER_ID.")
    if sleep is None:
        import time
        sleep = time.sleep

    domain = target(action)
    zone = select_zone(api, folder, domain)
    cert = select_certificate(api, folder, domain)
    if action != "prepare_online" and (not zone or not cert):
        raise WebHostingError(f"Missing {domain} zone or certificate; prepare and verify them first.")

    if action == "prepare_online":
        print(f"Prepare {domain}: zone={'reuse' if zone else 'create'}, "
              f"certificate={'reuse' if cert else 'request'}.")
        print("Will NOT delegate NS, attach any domain or modify existing mezfit.ru resources.")
        if mode == "preview":
            return
        if not zone:
            # Re-read immediately before mutation, matching the DNS operator pattern.
            if select_zone(api, folder, domain):
                raise WebHostingError("DNS zone appeared concurrently; run Preview again.")
            operation = api(DNS, "Create protected public mezfit.online DNS zone", {
                "folderId": folder, "name": DOMAINS[domain]["zone_name"],
                "zone": domain + ".", "publicVisibility": {},
                "deletionProtection": True,
                "description": "MezFit online domain; registrar delegation is separate",
            })
            response = await_operation(api, operation, "Create online DNS zone", sleep)
            zone = select_zone(api, folder, domain)
            if not zone or zone["id"] != response.get("id"):
                raise WebHostingError("New public DNS zone failed readback verification.")
        if not cert:
            if select_certificate(api, folder, domain):
                raise WebHostingError("Certificate appeared concurrently; run Preview again.")
            operation = api(f"{CERTIFICATES}/requestNew", "Request mezfit.online managed TLS certificate", {
                "folderId": folder, "name": DOMAINS[domain]["cert_name"],
                "domains": [domain], "challengeType": "DNS",
                "deletionProtection": True,
            })
            response = await_operation(api, operation, "Request online TLS", sleep)
            cert = select_certificate(api, folder, domain)
            if not cert or cert["id"] != response.get("id"):
                raise WebHostingError("New TLS certificate failed readback verification.")
        print("Prepared mezfit.online zone and managed TLS request; next: validate_online.")
        return

    gateway = get_gateway(api, folder) if action.startswith("activate_") else None
    if action.startswith("validate_"):
        challenge = dns_challenge(api, cert, domain)
        if challenge is None:
            print(f"{domain}: managed certificate already issued/renewing; no CNAME change.")
            return
        existing = check_record(list_records(api, zone["id"]), challenge["name"],
                                challenge["type"], challenge["data"][0])
        print(f"{domain} ownership CNAME {challenge['name']} -> {challenge['data'][0]}; "
              f"{'reuse' if existing else 'create'}")
        print("DNS verification works only after registrar NS points to Yandex Cloud.")
        if mode == "apply" and not existing:
            if check_record(list_records(api, zone["id"]), challenge["name"],
                            challenge["type"], challenge["data"][0]):
                raise WebHostingError("DNS record appeared concurrently; run Preview again.")
            apply_record(api, zone, challenge, f"Write {domain} validation CNAME", sleep)
        return

    if cert.get("status") != "ISSUED":
        raise WebHostingError(f"{domain} certificate status is {cert.get('status')}; require ISSUED.")
    linked = attached_to(gateway, domain, cert)
    value = gateway["domain"].rstrip(".") + "."
    name = domain + "."
    existing = check_record(list_records(api, zone["id"]), name, "ANAME", value)
    print(f"{domain}: Gateway binding={'reuse' if linked else 'attach'}, "
          f"DNS apex ANAME={'reuse' if existing else 'create'} -> {value}")
    print("ACTIVATION changes public routing after registrar DNS delegation. "
          "This does not configure a redirect or switch Telegram bot links.")
    if mode == "preview":
        return

    if not linked:
        fresh = get_gateway(api, folder)
        if attached_to(fresh, domain, cert):
            raise WebHostingError("Gateway attachment appeared concurrently; run Preview.")
        operation = api(f"{GATEWAYS}/{gateway['id']}:addDomain",
                        f"Attach {domain} to existing API Gateway",
                        {"domainName": domain, "certificateId": cert["id"]})
        await_operation(api, operation, f"Attach {domain}", sleep)
        fresh = get_gateway(api, folder)
        if not attached_to(fresh, domain, cert):
            raise WebHostingError("Domain attach operation not confirmed by gateway readback.")

    if not existing:
        if check_record(list_records(api, zone["id"]), name, "ANAME", value):
            raise WebHostingError("ANAME appeared concurrently; run Preview.")
        apply_record(api, zone, {"name": name, "type": "ANAME",
                                "ttl": "300", "data": [value]},
                     f"Route {domain} apex to API Gateway", sleep)
    print(f"Verified {domain} binding and ANAME; DNS propagation and HTTPS need real-world checks.")


def main():
    token = os.environ.get("YC_IAM_TOKEN", "")
    if not token:
        raise WebHostingError("Missing short-lived Yandex IAM token.")
    opener = build_opener(NoRedirect())
    def api(url, label, payload=None):
        return request_json(opener, token, url, label, payload)
    execute(os.environ.get("MODE", ""), os.environ.get("ACTION", ""),
            os.environ.get("YC_FOLDER_ID", ""),
            api)


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
