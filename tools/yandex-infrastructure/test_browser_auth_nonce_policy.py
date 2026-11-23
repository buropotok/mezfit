import unittest
from unittest.mock import patch

from deploy_browser_auth import YandexHttpError, deploy_nonce_bucket_policy, ensure_nonce_bucket, main
from test_browser_auth_popup import PopupCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA, SECRET, SECRET_VERSION
from web_hosting import WebHostingError


class NonceBucketPolicy(unittest.TestCase):
    def setUp(self):
        self.cloud = PopupCloud()
        self.policy = deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA)

    def ensure_bucket(self, mode, api=None):
        return ensure_nonce_bucket(mode, FOLDER, SA, RUNTIME_SA, api or self.cloud,
                                   self.cloud.update, lambda _: None, nonce_policy=self.policy)

    def test_workflow_passes_deploy_policy_to_popup_operator(self):
        env = {"MODE": "preview", "ACTION": "popup", "CONFIRM": "", "YC_DEPLOY_SA_ID": SA,
               "YC_FOLDER_ID": FOLDER, "YC_IAM_TOKEN": "test-token"}
        with patch.dict("os.environ", env, clear=True), \
                patch("browser_auth_bootstrap.bootstrap", return_value=(RUNTIME_SA, SECRET, SECRET_VERSION)), \
                patch("deploy_browser_auth.execute") as execute:
            main()
        self.assertEqual(execute.call_args.kwargs["nonce_policy"], self.policy)

    def test_policy_scopes_deploy_readback_to_bucket_settings(self):
        runtime_rule, deploy_rule = self.policy["Statement"]
        self.assertEqual(runtime_rule, self.cloud.policy["Statement"][0])
        self.assertEqual(deploy_rule["Principal"], {"CanonicalUser": [SA]})
        self.assertEqual(deploy_rule["Resource"], [f"arn:aws:s3:::{self.cloud.settings['name']}"])
        self.assertEqual(deploy_rule["Condition"], {"Bool": {"aws:SecureTransport": "true"}})
        self.assertEqual(set(deploy_rule["Action"]), {
            "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLocation", "s3:GetBucketVersioning",
            "s3:GetBucketWebsite", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration",
        })

    def test_readable_legacy_policy_is_upgraded_only_on_apply(self):
        self.cloud.nonce_bucket = {**self.cloud.settings, "policy": self.cloud.policy}
        self.ensure_bucket("preview")
        self.assertEqual(self.cloud.writes, [])
        self.ensure_bucket("apply")
        self.assertEqual(self.cloud.nonce_bucket["policy"], self.policy)
        self.ensure_bucket("apply")
        self.assertEqual(len(self.cloud.writes), 1)

    def test_unreadable_bucket_and_policy_drift_block_writes(self):
        self.cloud.nonce_bucket = {**self.cloud.settings, "policy": {"Statement": []}}
        with self.assertRaisesRegex(WebHostingError, "private contract in: policy"):
            self.ensure_bucket("apply")

        def forbidden(url, label, payload=None):
            if url.endswith("?view=VIEW_FULL"):
                raise YandexHttpError(label, 403)
            return self.cloud(url, label, payload)

        with self.assertRaisesRegex(WebHostingError, r"\(preflight\): HTTP 403.*nonce bucket recovery"):
            self.ensure_bucket("apply", forbidden)
        self.assertEqual(self.cloud.writes, [])
