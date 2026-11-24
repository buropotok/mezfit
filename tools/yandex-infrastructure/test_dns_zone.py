"""Contract tests for the isolated Yandex DNS foundation operator (stdlib only)."""

import unittest
from urllib.parse import parse_qs, urlparse

from dns_zone import (
    DNS_API, OPERATIONS_API, DnsSetupError,
    execute, list_zones, matching_zone,
)

FOLDER = "b1gexample"
PUBLIC_ZONE = {
    "id": "dnszone123", "folderId": FOLDER, "name": "mezfit-ru",
    "zone": "mezfit.ru.", "publicVisibility": {}, "deletionProtection": True,
}


class FakeYandexDns:
    def __init__(self, zones=None, *, operation_ok=True):
        self.zones = list(zones or [])
        self.writes = []
        self.operation_ok = operation_ok

    def __call__(self, url, label, payload=None):
        if url.startswith(DNS_API + "?"):
            return {"dnsZones": [dict(zone) for zone in self.zones]}
        if url == DNS_API and payload is not None:
            self.writes.append(payload)
            self.zones.append({
                "id": "dnszone123", "folderId": payload["folderId"],
                "name": payload["name"], "zone": payload["zone"],
                "publicVisibility": payload["publicVisibility"],
                "deletionProtection": payload["deletionProtection"],
            })
            return {
                "id": "operation123", "done": True,
                "response": {"id": "dnszone123"} if self.operation_ok else {},
                "error": None if self.operation_ok else {"code": 7},
            }
        if url == DNS_API + "/dnszone123":
            return dict(self.zones[-1])
        if url.startswith(OPERATIONS_API + "/"):
            raise AssertionError("Immediate-operation mock should not be polled")
        raise AssertionError(f"Unexpected API call: {label} {url}")


class DnsFoundationTests(unittest.TestCase):
    def test_preview_never_writes(self):
        api = FakeYandexDns()
        execute("preview", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_apply_creates_protected_public_zone_once_and_reuses_it(self):
        api = FakeYandexDns()
        execute("apply", FOLDER, api)
        execute("apply", FOLDER, api)
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.writes[0]["publicVisibility"], {})
        self.assertTrue(api.writes[0]["deletionProtection"])
        self.assertEqual(api.writes[0]["zone"], "mezfit.ru.")
        self.assertEqual(api.writes[0]["folderId"], FOLDER)

    def test_invalid_mode_is_denied_without_api_calls(self):
        class NoApi:
            def __call__(self, *args, **kwargs):
                raise AssertionError("No API call expected")
        with self.assertRaises(DnsSetupError):
            execute("invalid", FOLDER, NoApi())

    def test_existing_public_zone_is_accepted_without_mutation(self):
        api = FakeYandexDns([PUBLIC_ZONE])
        execute("apply", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_private_zone_or_wrong_name_is_rejected(self):
        private = dict(PUBLIC_ZONE)
        private.pop("publicVisibility")
        private["privateVisibility"] = {"networkIds": []}
        for zone in (private, {**PUBLIC_ZONE, "name": "wrong-name"},
                     {**PUBLIC_ZONE, "zone": "other.ru."}):
            with self.subTest(zone=zone):
                api = FakeYandexDns([zone])
                with self.assertRaises(DnsSetupError):
                    execute("apply", FOLDER, api)
                self.assertEqual(api.writes, [])

    def test_multiple_matching_zones_are_rejected(self):
        duplicate = {**PUBLIC_ZONE, "id": "another123", "name": "other-public"}
        with self.assertRaises(DnsSetupError):
            matching_zone([PUBLIC_ZONE, duplicate], FOLDER)

    def test_failed_operation_never_reports_success(self):
        api = FakeYandexDns(operation_ok=False)
        with self.assertRaises(DnsSetupError):
            execute("apply", FOLDER, api)
        self.assertEqual(len(api.writes), 1)

    def test_list_reads_subsequent_pages(self):
        seen = []
        def paged_api(url, label, payload=None):
            query = parse_qs(urlparse(url).query)
            seen.append(query.get("pageToken", [""])[0])
            if len(seen) == 1:
                return {"dnsZones": [], "nextPageToken": "next-page"}
            return {"dnsZones": [PUBLIC_ZONE]}
        self.assertEqual(list_zones(FOLDER, paged_api), [PUBLIC_ZONE])
        self.assertEqual(seen, ["", "next-page"])

    def test_pagination_loop_is_rejected(self):
        def looping_api(url, label, payload=None):
            return {"dnsZones": [], "nextPageToken": "same"}
        with self.assertRaises(DnsSetupError):
            list_zones(FOLDER, looping_api)

    def test_malformed_list_is_rejected(self):
        with self.assertRaises(DnsSetupError):
            list_zones(FOLDER, lambda *_: {"dnsZones": {"id": "unexpected"}})


if __name__ == "__main__":
    unittest.main()
