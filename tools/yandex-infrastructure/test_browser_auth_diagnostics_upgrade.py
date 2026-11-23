"""Upgrade-only contract tests for the safely tagged Telegram OIDC diagnostics release.

These tests do not alter pre-existing Prepare/Activate or auth test assertions.
"""

import unittest

from browser_auth_bootstrap import bootstrap
from deploy_browser_auth import (
    BASELINE_FINGERPRINT, PREVIOUS_TAG, TAG, UPGRADE, VERSIONS,
    version_secrets, source_package,
)
from test_browser_auth_bootstrap import FakeBootstrapCloud, FOLDER as BOOTSTRAP_FOLDER
from test_deploy_browser_auth import (
    FakeCloud, FOLDER, SA, RUNTIME_SA, SECRET, SECRET_VERSION, DOMAIN,
)
from web_hosting import WebHostingError, browser_auth_gateway_spec, bucket_name


class UpgradeCloud(FakeCloud):
    def __init__(self):
        super().__init__()
        self.function = {
            "id": "function1", "name": "mezfit-browser-login", "folderId": FOLDER,
            "status": "ACTIVE",
        }
        self.spec = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA)
        self.bindings = [{"roleId": "functions.functionInvoker",
                          "subject": {"type": "serviceAccount", "id": SA}}]
        self.versions = [{
            "id": "version1", "functionId": "function1",
            "description": BASELINE_FINGERPRINT,
            "runtime": "nodejs22", "entrypoint": "index.handler",
            "serviceAccountId": RUNTIME_SA,
            "environment": {"MEZFIT_AUTH_HOSTS": ",".join([DOMAIN, "mezfit.online", "mezfit.ru"])},
            "secrets": version_secrets(SECRET, SECRET_VERSION),
            "tags": [TAG], "status": "ACTIVE",
        }]
        self.fail_tag_once = False

    def __call__(self, url, label, payload=None):
        if payload is not None and url == VERSIONS:
            self.writes.append((url, payload))
            self.versions.append({
                "id": "version2", "functionId": "function1",
                "description": payload["description"],
                "runtime": payload["runtime"], "entrypoint": payload["entrypoint"],
                "serviceAccountId": payload["serviceAccountId"],
                "environment": payload["environment"],
                "secrets": payload["secrets"],
                "tags": list(payload["tag"]),
                "status": "ACTIVE",
            })
            return self.operation({"id": "version2"})
        if payload is not None and url.endswith(":setTag"):
            self.writes.append((url, payload))
            if self.fail_tag_once and url.endswith("/version2:setTag"):
                self.fail_tag_once = False
                raise WebHostingError("Simulated infrastructure interruption")
            version_id = url.split("/")[-1].split(":")[0]
            target = [v for v in self.versions if v["id"] == version_id]
            if len(target) != 1:
                raise AssertionError("Unknown version")
            new_tag = payload["tag"]
            for version in self.versions:
                if new_tag in version["tags"]:
                    version["tags"].remove(new_tag)
            target[0]["tags"].append(new_tag)
            return self.operation({})
        return super().__call__(url, label, payload)


class OidcDiagnosticsUpgradeContracts(unittest.TestCase):
    def test_confirmation_preview_and_metadata_only_bootstrap(self):
        cloud = UpgradeCloud()
        cloud.execute("preview", "upgrade", "")
        self.assertEqual(cloud.writes, [])
        with self.assertRaisesRegex(WebHostingError, "confirmation"):
            cloud.execute("apply", "upgrade", "WRONG")
        self.assertEqual(cloud.writes, [])
        self.assertEqual(cloud.versions[0]["tags"], [TAG])

        secrets = FakeBootstrapCloud()
        with self.assertRaisesRegex(WebHostingError, "Prepare first"):
            bootstrap("apply", "upgrade", BOOTSTRAP_FOLDER, secrets)
        self.assertEqual(secrets.writes, [])
        secrets.bootstrap("apply")
        before = len(secrets.writes)
        self.assertEqual(secrets.bootstrap("apply", action="upgrade"),
                         ("ajeruntimeaccount", "e1lockboxsecret", "e2pinnedversion"))
        self.assertEqual(len(secrets.writes), before)

    def test_exact_version_upgrade_keeps_rollback_and_never_touches_gateway(self):
        cloud = UpgradeCloud()
        old_gateway = cloud.spec.copy()
        cloud.execute("apply", "upgrade", UPGRADE)
        self.assertEqual([url for url, _ in cloud.writes], [
            VERSIONS + "/version1:setTag", VERSIONS, VERSIONS + "/version2:setTag",
        ])
        self.assertEqual(cloud.writes[0][1], {"tag": PREVIOUS_TAG})
        self.assertEqual(cloud.writes[1][1]["tag"], [])
        self.assertEqual(cloud.writes[2][1], {"tag": TAG})
        self.assertEqual(cloud.versions[0]["tags"], [PREVIOUS_TAG])
        self.assertEqual(cloud.versions[1]["tags"], [TAG])
        self.assertEqual(cloud.versions[1]["description"], source_package()[1])
        self.assertEqual(cloud.spec, old_gateway)
        cloud.execute("apply", "upgrade", UPGRADE)
        self.assertEqual(len(cloud.writes), 3)

    def test_gateway_or_serving_version_drift_never_overwritten(self):
        stale = UpgradeCloud()
        stale.versions[0]["description"] = "Unknown version, not approved"
        with self.assertRaisesRegex(WebHostingError, "approved baseline"):
            stale.execute("apply", "upgrade", UPGRADE)
        self.assertEqual(stale.writes, [])

        changed_routes = UpgradeCloud()
        changed_routes.spec["paths"]["/api"]["get"]["x-yc-apigateway-integration"]["http_code"] = 200
        with self.assertRaises(WebHostingError):
            changed_routes.execute("apply", "upgrade", UPGRADE)
        self.assertEqual(changed_routes.writes, [])

    def test_upgraded_version_without_retained_baseline_is_rejected(self):
        cloud = UpgradeCloud()
        cloud.execute("apply", "upgrade", UPGRADE)
        cloud.versions[0]["tags"].remove(PREVIOUS_TAG)
        before = len(cloud.writes)
        with self.assertRaisesRegex(WebHostingError, "rollback baseline"):
            cloud.execute("apply", "upgrade", UPGRADE)
        self.assertEqual(len(cloud.writes), before)

    def test_interrupted_upgrade_reuses_verified_candidate_without_redeploying(self):
        cloud = UpgradeCloud()
        cloud.fail_tag_once = True
        with self.assertRaisesRegex(WebHostingError, "Simulated infrastructure interruption"):
            cloud.execute("apply", "upgrade", UPGRADE)
        self.assertEqual([url for url, _ in cloud.writes], [
            VERSIONS + "/version1:setTag", VERSIONS, VERSIONS + "/version2:setTag",
        ])
        cloud.execute("apply", "upgrade", UPGRADE)
        self.assertEqual([url for url, _ in cloud.writes][-1],
                         VERSIONS + "/version2:setTag")
        self.assertEqual(len([url for url, _ in cloud.writes if url == VERSIONS]), 1)
        self.assertIn(PREVIOUS_TAG, cloud.versions[0]["tags"])
        self.assertIn(TAG, cloud.versions[1]["tags"])


if __name__ == "__main__":
    unittest.main()
