"""Contract tests for MezFit Yandex web foundation; no live Yandex calls."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from web_hosting import (
    CERTIFICATES, GATEWAYS, STORAGE, CONFIRMATION, DOMAIN,
    NAME_CERTIFICATE, NAME_GATEWAY, SAFE_FLAGS, WebHostingError,
    bucket_name, execute, gateway_spec, paged_list, verify_bucket,
)
from publish_spa import files_to_publish, headers_for, publish

FOLDER = "b1ggoodfolderid"


class FakeYandex:
    def __init__(self):
        self.buckets = []
        self.gateways = []
        self.certificates = []
        self.writes = []
        self.fail_creation = False

    def __call__(self, url, label, payload=None):
        if url.startswith(STORAGE + "?"):
            return {"buckets": list(self.buckets)}
        if url.startswith(GATEWAYS + "?"):
            return {"apiGateways": list(self.gateways)}
        if url.startswith(CERTIFICATES + "?"):
            return {"certificates": list(self.certificates)}
        if url == STORAGE and payload is not None:
            self.writes.append(("bucket", payload))
            self.buckets.append({
                "folderId": FOLDER, "name": bucket_name(FOLDER),
                "anonymousAccessFlags": SAFE_FLAGS,
            })
            return {"id": "operationbucket", "done": True, "response": {
                "name": bucket_name(FOLDER),
            }}
        if url == GATEWAYS and payload is not None:
            self.writes.append(("gateway", payload))
            self.gateways.append({
                "folderId": FOLDER, "name": NAME_GATEWAY, "id": "gate1",
                "status": "ACTIVE", "domain": "gateway.example",
                "attachedDomains": [],
                "spec": payload["openapiSpec"],
            })
            return {"id": "operationgateway", "done": True, "response": {"id": "gate1"}}
        if url == CERTIFICATES + "/requestNew" and payload is not None:
            self.writes.append(("certificate", payload))
            self.certificates.append({
                "id": "cert1", "folderId": FOLDER, "name": NAME_CERTIFICATE,
                "domains": [DOMAIN], "type": "MANAGED",
                "deletionProtection": True, "status": "VALIDATING",
            })
            return {"id": "operationcertificate", "done": True, "response": {"id": "cert1"}}
        if url == GATEWAYS + "/gate1:spec":
            return {"openapiSpec": self.gateways[0]["spec"]}
        if url == CERTIFICATES + "/cert1?view=FULL":
            return {"status": "VALIDATING", "challenges": [{
                "dnsChallenge": {"name": "_acme-challenge.mezfit.ru.", "type": "CNAME", "value": "test.example."},
            }]}
        raise AssertionError(f"Unexpected endpoint {url} ({label})")


class WebHostingContracts(unittest.TestCase):
    def test_preview_is_read_only(self):
        api = FakeYandex()
        execute("preview", "", FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_apply_requires_exact_confirmation_without_api_calls(self):
        with self.assertRaises(WebHostingError):
            execute("apply", "wrong", FOLDER, lambda *args: self.fail("must not call API"))

    def test_create_then_reuse_all_three_resources(self):
        api = FakeYandex()
        execute("apply", CONFIRMATION, FOLDER, api, sleep=lambda _: None)
        execute("apply", CONFIRMATION, FOLDER, api, sleep=lambda _: None)
        self.assertEqual([kind for kind, _ in api.writes],
                         ["bucket", "gateway", "certificate"])
        self.assertEqual(api.writes[0][1]["anonymousAccessFlags"], SAFE_FLAGS)
        self.assertEqual(api.writes[2][1]["challengeType"], "DNS")
        self.assertTrue(api.writes[2][1]["deletionProtection"])

    def test_private_flags_or_public_list_are_rejected(self):
        for flags in ({"read": False, "list": False, "configRead": False},
                      {"read": True, "list": True, "configRead": False}):
            with self.subTest(flags=flags):
                api = FakeYandex()
                api.buckets = [{
                    "folderId": FOLDER, "name": bucket_name(FOLDER),
                    "anonymousAccessFlags": flags,
                }]
                with self.assertRaises(WebHostingError):
                    execute("apply", CONFIRMATION, FOLDER, api)
                self.assertEqual(api.writes, [])

    def test_existing_gateway_spec_drift_fails_before_writes(self):
        api = FakeYandex()
        api.gateways = [{
            "name": NAME_GATEWAY, "folderId": FOLDER, "id": "gate1",
            "status": "ACTIVE", "attachedDomains": [],
            "spec": json.dumps({"openapi": "3.0.0", "paths": {}}),
        }]
        with self.assertRaises(WebHostingError):
            execute("apply", CONFIRMATION, FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_invalid_existing_certificate_fails_before_writes(self):
        api = FakeYandex()
        api.certificates = [{
            "id": "cert1", "folderId": FOLDER, "name": NAME_CERTIFICATE,
            "domains": ["other.ru"], "type": "MANAGED", "deletionProtection": True,
        }]
        with self.assertRaises(WebHostingError):
            execute("apply", CONFIRMATION, FOLDER, api)
        self.assertEqual(api.writes, [])

    def test_gateway_never_masks_unmigrated_api(self):
        spec = gateway_spec(bucket_name(FOLDER))
        self.assertEqual(spec["paths"]["/api/{proxy+}"]["post"]
                         ["x-yc-apigateway-integration"]["http_code"], 503)
        self.assertNotIn("error_object", spec["paths"]["/assets/{file+}"]["get"]
                         ["x-yc-apigateway-integration"])
        self.assertEqual(spec["paths"]["/{file+}"]["get"]["x-yc-apigateway-integration"]
                         ["error_object"]["object"], "index.html")

    def test_malformed_paginated_response_rejected(self):
        with self.assertRaises(WebHostingError):
            paged_list(lambda *_: {"buckets": "bad"}, STORAGE, FOLDER, "buckets", "List")

    def test_bucket_wrong_folder_rejected(self):
        with self.assertRaises(WebHostingError):
            verify_bucket({"folderId": "wrong", "name": bucket_name(FOLDER),
                           "anonymousAccessFlags": SAFE_FLAGS}, FOLDER)


class SpaPublishContracts(unittest.TestCase):
    def test_publish_html_last_with_correct_cache_and_mime(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "index.html").write_text("<html>ok</html>", encoding="utf-8")
            (root / "assets").mkdir()
            (root / "assets" / "app-12345678.js").write_bytes(b"export const x=1;")
            seen = []
            publish(root, "bucket1", "fake-token",
                    lambda bucket, key, body, headers: seen.append((key, headers)))
            self.assertEqual([key for key, _ in seen],
                             ["assets/app-12345678.js", "index.html"])
            self.assertIn("immutable", seen[0][1]["Cache-Control"])
            self.assertEqual(seen[1][1]["Cache-Control"], "no-store")
            self.assertEqual(seen[0][1]["Content-Type"],
                             "application/javascript; charset=utf-8")

    def test_empty_or_missing_index_is_refused(self):
        with TemporaryDirectory() as folder:
            with self.assertRaises(WebHostingError):
                files_to_publish(folder)

    def test_hidden_file_refused(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "index.html").write_text("ok")
            (root / ".env").write_text("secret")
            (root / "asset.js").write_text("ok")
            with self.assertRaises(WebHostingError):
                files_to_publish(root)

    def test_symlink_refused(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "index.html").write_text("ok")
            (root / "asset.js").write_text("ok")
            (root / "linked").symlink_to(root / "asset.js")
            with self.assertRaises(WebHostingError):
                files_to_publish(root)


if __name__ == "__main__":
    unittest.main()
