"""Offline contract tests for dual-domain DNS, TLS and gateway staging."""

import json
from copy import deepcopy
import unittest

from dual_domains import (
    ACTIONS, CONFIRMATIONS, DNS, check_record, execute, get_gateway,
    select_certificate, select_zone,
)
from web_hosting import (
    CERTIFICATES, GATEWAYS, WebHostingError, bucket_name, gateway_spec,
    verify_gateway,
)

FOLDER = "b1ggoodfolderid"
GATEWAY_DOMAIN = "d5dexample.i9.apigw.yandexcloud.net"


class FakeCloud:
    def __init__(self):
        self.zones = [{
            "id": "zru", "name": "mezfit-ru", "folderId": FOLDER,
            "zone": "mezfit.ru.", "publicVisibility": {},
            "deletionProtection": True,
        }]
        self.certificates = [{
            "id": "cru", "folderId": FOLDER, "name": "mezfit-ru-web",
            "domains": ["mezfit.ru"], "type": "MANAGED",
            "deletionProtection": True, "status": "VALIDATING",
        }]
        self.gateway = {
            "id": "gateway1", "name": "mezfit-web", "folderId": FOLDER,
            "domain": GATEWAY_DOMAIN, "status": "ACTIVE",
            "attachedDomains": [],
        }
        self.records = {"zru": []}
        self.writes = []

    def __call__(self, url, label, payload=None):
        if payload is not None:
            self.writes.append((url, deepcopy(payload)))
            if url == DNS:
                self.zones.append({
                    "id": "zon", "name": "mezfit-online", "folderId": FOLDER,
                    "zone": "mezfit.online.", "publicVisibility": {},
                    "deletionProtection": True,
                })
                self.records["zon"] = []
                return self.operation({"id": "zon"})
            if url == CERTIFICATES + "/requestNew":
                self.certificates.append({
                    "id": "con", "folderId": FOLDER, "name": "mezfit-online-web",
                    "domains": ["mezfit.online"], "type": "MANAGED",
                    "deletionProtection": True, "status": "VALIDATING",
                })
                return self.operation({"id": "con"})
            if url.startswith(DNS + "/") and url.endswith(":updateRecordSets"):
                zone_id = url[len(DNS) + 1:].split(":")[0]
                self.records[zone_id].extend(deepcopy(payload["additions"]))
                return self.operation({})
            if url == GATEWAYS + "/gateway1:addDomain":
                self.gateway["attachedDomains"].append({
                    "domain": payload["domainName"],
                    "certificateId": payload["certificateId"], "enabled": True,
                })
                return self.operation({})
            raise AssertionError(f"Unexpected write {url}")
        if url.startswith(DNS + "?"):
            return {"dnsZones": deepcopy(self.zones)}
        if url.startswith(CERTIFICATES + "?"):
            return {"certificates": deepcopy(self.certificates)}
        if url.startswith(GATEWAYS + "?"):
            return {"apiGateways": [deepcopy(self.gateway)]}
        if url == GATEWAYS + "/gateway1:spec":
            return {"openapiSpec": json.dumps(gateway_spec(bucket_name(FOLDER)))}
        if url.startswith(DNS + "/") and ":listRecordSets?" in url:
            zone_id = url[len(DNS) + 1:].split(":")[0]
            return {"recordSets": deepcopy(self.records[zone_id])}
        if url.startswith(CERTIFICATES + "/") and "?view=FULL" in url:
            cert_id = url[len(CERTIFICATES) + 1:].split("?")[0]
            cert = next(c for c in self.certificates if c["id"] == cert_id)
            domain = cert["domains"][0]
            return {**deepcopy(cert), "challenges": [{
                "domain": domain,
                "dnsChallenge": {
                    "name": f"_acme-challenge.{domain}.", "type": "CNAME",
                    "value": f"verify-{domain.replace('.', '-')}.acme.yandexcloud.net.",
                },
            }]}
        raise AssertionError(f"Unexpected read {url} ({label})")

    def operation(self, response):
        return {"id": "op123", "done": True, "response": response}

    def prepare_online(self):
        execute("apply", "prepare_online", CONFIRMATIONS["prepare_online"],
                FOLDER, self, sleep=lambda _: None)

    def issue(self, domain):
        cert = next(c for c in self.certificates if c["domains"] == [domain])
        cert["status"] = "ISSUED"


class DomainContracts(unittest.TestCase):
    def test_preview_of_foundation_does_not_create_resources(self):
        api = FakeCloud()
        execute("preview", "prepare_online", "", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_each_action_has_its_own_exact_confirmation(self):
        api = FakeCloud()
        for action in ACTIONS:
            with self.subTest(action=action):
                with self.assertRaisesRegex(WebHostingError, "confirmation"):
                    execute("apply", action, "INCORRECT", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_prepare_online_creates_only_missing_online_resources(self):
        api = FakeCloud()
        api.prepare_online()
        api.prepare_online()
        self.assertEqual(len(api.writes), 2)
        self.assertEqual(api.writes[0][0], DNS)
        self.assertEqual(api.writes[0][1]["zone"], "mezfit.online.")
        self.assertTrue(api.writes[0][1]["deletionProtection"])
        self.assertEqual(api.writes[1][0], CERTIFICATES + "/requestNew")
        self.assertEqual(api.writes[1][1]["domains"], ["mezfit.online"])
        self.assertTrue(api.writes[1][1]["deletionProtection"])
        self.assertEqual(len(api.zones), 2)
        self.assertEqual(len(api.certificates), 2)

    def test_validation_creates_only_expected_cname_and_reuses(self):
        api = FakeCloud()
        api.prepare_online()
        execute("preview", "validate_online", "", FOLDER, api)
        self.assertEqual(len(api.writes), 2)
        execute("apply", "validate_online", CONFIRMATIONS["validate_online"],
                FOLDER, api, sleep=lambda _: None)
        execute("apply", "validate_online", CONFIRMATIONS["validate_online"],
                FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 3)
        record = api.records["zon"][0]
        self.assertEqual(record["type"], "CNAME")
        self.assertEqual(record["name"], "_acme-challenge.mezfit.online.")
        self.assertEqual(record["ttl"], "300")

    def test_ru_validation_is_independent_of_online(self):
        api = FakeCloud()
        execute("apply", "validate_ru", CONFIRMATIONS["validate_ru"],
                FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.records["zru"][0]["name"], "_acme-challenge.mezfit.ru.")
        self.assertEqual(len(api.zones), 1)

    def test_online_activation_reuses_gateway_and_preserves_ru(self):
        api = FakeCloud()
        api.prepare_online()
        api.issue("mezfit.online")
        execute("preview", "activate_online", "", FOLDER, api)
        self.assertEqual(len(api.writes), 2)
        execute("apply", "activate_online", CONFIRMATIONS["activate_online"],
                FOLDER, api, sleep=lambda _: None)
        execute("apply", "activate_online", CONFIRMATIONS["activate_online"],
                FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 4)
        self.assertEqual([x["domain"] for x in api.gateway["attachedDomains"]],
                         ["mezfit.online"])
        self.assertEqual(api.records["zon"][0]["type"], "ANAME")
        self.assertEqual(api.records["zon"][0]["data"],
                         [GATEWAY_DOMAIN + "."])
        self.assertEqual(verify_gateway(api.gateway, FOLDER, bucket_name(FOLDER), api),
                         api.gateway)
        self.assertEqual(len(api.records["zru"]), 0)

    def test_both_domains_attach_to_same_gateway(self):
        api = FakeCloud()
        api.prepare_online()
        api.issue("mezfit.online")
        api.issue("mezfit.ru")
        for domain in ("online", "ru"):
            action = "activate_" + domain
            execute("apply", action, CONFIRMATIONS[action],
                    FOLDER, api, sleep=lambda _: None)
        self.assertEqual({x["domain"] for x in api.gateway["attachedDomains"]},
                         {"mezfit.online", "mezfit.ru"})
        self.assertEqual(len(api.records["zon"]), 1)
        self.assertEqual(len(api.records["zru"]), 1)
        self.assertEqual(len({x["id"] for x in [api.gateway]}), 1)

    def test_invalid_certificate_cannot_publish_a_dns_challenge(self):
        api = FakeCloud()
        api.prepare_online()
        online = next(c for c in api.certificates if c["domains"] == ["mezfit.online"])
        online["status"] = "INVALID"
        with self.assertRaisesRegex(WebHostingError, "not awaiting validation"):
            execute("apply", "validate_online", CONFIRMATIONS["validate_online"],
                    FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 2)

    def test_inactive_gateway_cannot_activate_even_with_issued_certificate(self):
        api = FakeCloud()
        api.prepare_online()
        api.issue("mezfit.online")
        api.gateway["status"] = "UPDATING"
        with self.assertRaisesRegex(WebHostingError, "must be ACTIVE"):
            execute("apply", "activate_online", CONFIRMATIONS["activate_online"],
                    FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 2)

    def test_activation_refuses_unissued_certificate_without_writes(self):
        api = FakeCloud()
        api.prepare_online()
        with self.assertRaisesRegex(WebHostingError, "require ISSUED"):
            execute("apply", "activate_online", CONFIRMATIONS["activate_online"],
                    FOLDER, api, sleep=lambda _: None)
        self.assertEqual(len(api.writes), 2)

    def test_dns_record_conflicts_are_fail_closed(self):
        good = [{"name": "mezfit.online.", "type": "ANAME", "ttl": "300",
                 "data": [GATEWAY_DOMAIN + "."]}]
        for records in (
            good + [{"name": "mezfit.online.", "type": "A",
                     "ttl": "60", "data": ["203.0.113.10"]}],
            [{"name": "mezfit.online.", "type": "ANAME", "ttl": "300",
              "data": ["other.example."]}],
        ):
            with self.subTest(records=records):
                with self.assertRaises(WebHostingError):
                    check_record(records, "mezfit.online.", "ANAME", GATEWAY_DOMAIN + ".")
        with self.assertRaises(WebHostingError):
            check_record([{"name": "_acme-challenge.mezfit.online.", "type": "TXT",
                           "data": ["unsafe"]}],
                         "_acme-challenge.mezfit.online.", "CNAME", "verify.example.")

    def test_unauthorized_gateway_domain_does_not_break_safety(self):
        api = FakeCloud()
        api.prepare_online()
        api.issue("mezfit.online")
        api.gateway["attachedDomains"] = [{
            "domain": "unknown.example", "certificateId": "con", "enabled": True,
        }]
        with self.assertRaisesRegex(WebHostingError, "Unexpected gateway domain"):
            execute("preview", "activate_online", "", FOLDER, api)

    def test_unapproved_certificate_binding_is_blocked(self):
        api = FakeCloud()
        api.prepare_online()
        api.issue("mezfit.online")
        api.gateway["attachedDomains"] = [{
            "domain": "mezfit.online", "certificateId": "cru", "enabled": True,
        }]
        with self.assertRaisesRegex(WebHostingError, "Unexpected gateway domain"):
            execute("preview", "activate_online", "", FOLDER, api)

    def test_existing_ru_zone_is_never_replaced(self):
        api = FakeCloud()
        api.zones[0]["publicVisibility"] = None
        with self.assertRaises(WebHostingError):
            execute("preview", "validate_ru", "", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_missing_online_domain_requires_prepare(self):
        api = FakeCloud()
        with self.assertRaisesRegex(WebHostingError, "Missing mezfit.online"):
            execute("preview", "validate_online", "", FOLDER, api)


if __name__ == "__main__":
    unittest.main()
