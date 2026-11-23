"""Regression coverage for the real bucket management API readback boundary."""

from copy import deepcopy
import unittest

from deploy_browser_auth import POPUP
from test_browser_auth_popup import PopupCloud
from web_hosting import STORAGE, WebHostingError


class LifecycleReadbackCloud(PopupCloud):
    def update(self, url, label, payload, method):
        if label == "Install missing nonce lifecycle":
            assert url == f"{STORAGE}/{self.settings['name']}"
            assert method == "PATCH"
            assert payload == {"updateMask": "lifecycleRules",
                               "lifecycleRules": self.settings["lifecycleRules"]}
            self.writes.append((url, payload))
            self.nonce_bucket["lifecycleRules"] = deepcopy(payload["lifecycleRules"])
            return self.operation({})
        return super().update(url, label, payload, method)


class BrowserNonceBucketReadbackContract(unittest.TestCase):
    def test_inactive_cloud_defaults_are_equivalent_and_preview_is_read_only(self):
        cloud = PopupCloud()
        cloud.nonce_bucket = deepcopy(cloud.settings)
        cloud.nonce_bucket.pop("versioning")
        cloud.nonce_bucket["websiteSettings"] = {"index": "", "error": "", "routingRules": []}
        rule = cloud.nonce_bucket["lifecycleRules"][0]
        rule["transitions"] = []
        rule["filter"]["tag"] = {}
        rule["expiration"].update({"days": 1, "expiredObjectDeleteMarker": False})
        cloud.execute("preview", "popup", "")
        self.assertEqual(cloud.writes, [])

    def test_resumes_partially_created_owned_bucket_before_granting_write_access(self):
        cloud = LifecycleReadbackCloud()
        cloud.nonce_bucket = deepcopy(cloud.settings)
        cloud.nonce_bucket.pop("lifecycleRules")
        cloud.execute("preview", "popup", "")
        self.assertEqual(cloud.writes, [])
        cloud.execute("apply", "popup", POPUP)
        self.assertEqual(cloud.writes[0][1]["updateMask"], "lifecycleRules")
        self.assertEqual(cloud.nonce_bucket["lifecycleRules"], cloud.settings["lifecycleRules"])
        self.assertEqual(cloud.nonce_bucket["policy"], cloud.policy)

    def test_reports_security_or_retention_drift_by_field_without_mutations(self):
        for field, value in {
            "anonymousAccessFlags": {"list": True},
            "versioning": "VERSIONING_ENABLED",
            "websiteSettings": {"index": "index.html"},
            "lifecycleRules": [{"id": "unexpected", "enabled": True}],
            "policy": {"Statement": [{"Effect": "Allow", "Principal": "*"}]},
        }.items():
            with self.subTest(field=field):
                cloud = PopupCloud()
                cloud.nonce_bucket = {**deepcopy(cloud.settings), field: value}
                with self.assertRaisesRegex(WebHostingError, field):
                    cloud.execute("apply", "popup", POPUP)
                self.assertEqual(cloud.writes, [])

    def test_missing_retention_with_active_policy_is_not_automatically_repaired(self):
        cloud = LifecycleReadbackCloud()
        cloud.nonce_bucket = {**deepcopy(cloud.settings), "policy": cloud.policy}
        cloud.nonce_bucket.pop("lifecycleRules")
        with self.assertRaisesRegex(WebHostingError, "lifecycleRules"):
            cloud.execute("apply", "popup", POPUP)
        self.assertEqual(cloud.writes, [])
