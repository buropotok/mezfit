"""Contracts for publishing a new browser handler over the initial mirror release."""
from unittest import TestCase

import test_browser_auth_jwks_bucket
from deploy_browser_auth import PREVIOUS_MIRROR_FINGERPRINT, TAG, VERSIONS
from jwks_mirror import reader_binding
from test_deploy_browser_auth import RUNTIME_SA


class BrowserAuthMirrorUpgradeTests(TestCase):
    def test_upgrade_reviewed_previous_version_in_place(self):
        cloud = test_browser_auth_jwks_bucket.MirrorCloud()
        old = cloud.versions[-1]
        old["description"] = PREVIOUS_MIRROR_FINGERPRINT
        old["environment"]["MEZFIT_BROWSER_JWKS_BUCKET"] = cloud.mirror_name
        cloud.mirror_bindings.append(reader_binding(RUNTIME_SA))
        cloud.execute("preview", "popup-mirror")
        self.assertEqual(cloud.writes, [])
        cloud.execute("apply", "popup-mirror")
        self.assertEqual([url for url, _ in cloud.writes], [
            VERSIONS, VERSIONS + "/version2:setTag",
        ])
        self.assertNotIn(TAG, old["tags"])
        self.assertIn(TAG, cloud.versions[-1]["tags"])
