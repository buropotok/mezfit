"""Offline contract tests for owner-only Yandex Telegram JWKS bootstrap."""
import json
import tempfile
import unittest
from pathlib import Path

import jwks_mirror as mirror
from web_hosting import WebHostingError

FOLDER = "b1g774t6sgop4rakjob7"
DEPLOY = "ajeijn4c6747d0l7dmel"
SA_ID = "aje00000000000000001"
BUCKET_RESOURCE_ID = "e3e00000000000000001"


class FakeCloud:
    def __init__(self):
        self.sa = None
        self.bucket = None
        self.binding = []
        self.keys = []
        self.writes = []

    def __call__(self, url, label, payload=None, method=None):
        if payload is not None:
            self.writes.append((url, method or "POST"))
        if url.startswith(mirror.IAM_SA + "?"):
            return {"serviceAccounts": [self.sa] if self.sa else []}
        if url == mirror.IAM_SA:
            self.sa = {"id": SA_ID, "name": mirror.NAME_SA, "folderId": FOLDER}
            return {"id": "op0001", "done": True, "response": {"id": SA_ID}}
        if url.startswith(mirror.STORAGE + "?"):
            return {"buckets": [self.bucket] if self.bucket else []}
        if url == f"{mirror.STORAGE}/{mirror.bucket_name(FOLDER)}?view=VIEW_FULL":
            if not self.bucket:
                raise AssertionError("Bucket metadata before creation")
            return self.bucket
        if url == mirror.STORAGE:
            self.bucket = {
                "name": mirror.bucket_name(FOLDER), "folderId": FOLDER,
                "resourceId": BUCKET_RESOURCE_ID, "anonymousAccessFlags": mirror.PRIVATE,
                "acl": {"grants": []},
            }
            return {"id": "op0002", "done": True, "response": {"name": self.bucket["name"]}}
        if url == f"{mirror.STORAGE}/{BUCKET_RESOURCE_ID}:listAccessBindings":
            return {"accessBindings": self.binding}
        if url == f"{mirror.STORAGE}/{BUCKET_RESOURCE_ID}:updateAccessBindings":
            assert method == "PATCH"
            self.binding = [payload["accessBindingDeltas"][0]["accessBinding"]]
            return {"id": "op0003", "done": True, "response": {}}
        if url.startswith(mirror.IAM_KEYS + "?"):
            return {"accessKeys": list(self.keys)}
        if url == mirror.IAM_KEYS:
            key = {"serviceAccountId": SA_ID, "keyId": "YCAJE00000000000001"}
            self.keys.append(key)
            return {"accessKey": key, "secret": "secret-is-staged-only-in-temporary-path"}
        raise AssertionError(f"Unexpected operator API: {label} {url}")


class JwksMirrorTests(unittest.TestCase):
    def call(self, fake, mode="preview", action="prepare", output=None):
        mirror.execute(mode, action, FOLDER, DEPLOY, fake, output, sleep=lambda _: None)

    def test_preview_is_strictly_read_only(self):
        fake = FakeCloud()
        self.call(fake)
        self.assertEqual(fake.writes, [])

    def test_rejects_invalid_operation(self):
        fake = FakeCloud()
        with self.assertRaises(WebHostingError):
            self.call(fake, "apply", action="unknown")
        self.assertEqual(fake.writes, [])

    def test_create_scoped_resources_and_reuse_without_new_key(self):
        fake = FakeCloud()
        self.call(fake, "apply", "prepare")
        self.assertEqual(fake.binding, [mirror.expected_binding(SA_ID)])
        self.assertEqual(fake.keys, [])
        count = len(fake.writes)
        self.call(fake, "apply", "prepare")
        self.assertEqual(count, len(fake.writes))

    def test_activation_creates_one_key_and_prevents_silent_rotation(self):
        fake = FakeCloud()
        self.call(fake, "apply", "prepare")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.json"
            self.call(fake, "preview", "activate")
            self.assertFalse(path.exists())
            self.call(fake, "apply", "activate", str(path))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            secret = json.loads(path.read_text())
            self.assertEqual(secret["YC_JWKS_ACCESS_KEY_ID"], fake.keys[0]["keyId"])
            self.assertEqual(secret["YC_JWKS_SECRET_ACCESS_KEY"], "secret-is-staged-only-in-temporary-path")
            with self.assertRaises(WebHostingError):
                self.call(fake, "apply", "activate", str(path))
            self.assertEqual(len(fake.keys), 1)

    def test_public_or_unexpected_iam_bucket_is_rejected(self):
        fake = FakeCloud()
        self.call(fake, "apply", "prepare")
        fake.bucket["anonymousAccessFlags"] = {"read": True, "list": False, "configRead": False}
        with self.assertRaises(WebHostingError):
            self.call(fake)
        fake.bucket["anonymousAccessFlags"] = mirror.PRIVATE
        fake.binding = [{"roleId": "storage.admin", "subject": {
            "type": "serviceAccount", "id": SA_ID
        }}]
        with self.assertRaises(WebHostingError):
            self.call(fake)


    def test_upgrade_reuses_one_existing_key_without_yandex_writes(self):
        fake = FakeCloud()
        self.call(fake, "apply", "prepare")
        with self.assertRaises(WebHostingError):
            self.call(fake, "preview", "upgrade")
        fake.keys.append({"serviceAccountId": SA_ID, "keyId": "YCAJEK0Iv6xqy-pEQcueLTAdg"})
        count = len(fake.writes)
        self.call(fake, "preview", "upgrade")
        self.call(fake, "apply", "upgrade")
        self.assertEqual(count, len(fake.writes))
        self.assertEqual(len(fake.keys), 1)
        fake.keys.append({"serviceAccountId": SA_ID, "keyId": "YCAJEanother"})
        with self.assertRaises(WebHostingError):
            self.call(fake, "preview", "upgrade")


if __name__ == "__main__":
    unittest.main()
