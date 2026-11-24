"""Contract tests for the owner-only Yandex browser Dexie token route."""

from copy import deepcopy
import unittest

import jwks_mirror
from browser_auth_bootstrap import LOCKBOX
from deploy_browser_auth import (
    DEXIE_SECRET_NAME, DEXIE_TOKENS, DEXIE_TOKENS_ROLLBACK, LONG_SESSION_MIRROR_FINGERPRINT,
    TAG, VERSIONS, nonce_bucket_name,
)
from test_browser_auth_diagnostics_upgrade import UpgradeCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA, SECRET, SECRET_VERSION
from web_hosting import (
    DEXIE_TOKEN_PATH, DEXIE_TOKEN_TAG, GATEWAYS, WebHostingError, browser_auth_gateway_spec, bucket_name,
)


class DexieTokenCloud(UpgradeCloud):
    def __init__(self):
        super().__init__()
        self.spec = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA, popup=True)
        baseline = self.versions[0]
        baseline["description"] = LONG_SESSION_MIRROR_FINGERPRINT
        baseline["environment"].update({
            "MEZFIT_BROWSER_CHALLENGE_BUCKET": nonce_bucket_name(FOLDER),
            "MEZFIT_BROWSER_JWKS_BUCKET": jwks_mirror.bucket_name(FOLDER),
        })
        self.dexie_secret = {
            "id": "dexiesecret", "name": DEXIE_SECRET_NAME, "folderId": FOLDER,
            "status": "ACTIVE", "deletionProtection": True, "currentVersion": {
                "id": "dexieversion", "secretId": "dexiesecret", "status": "ACTIVE",
                "payloadEntryKeys": ["client_id", "client_secret"],
            },
        }
        self.lockbox_bindings = [{
            "roleId": "lockbox.payloadViewer",
            "subject": {"type": "serviceAccount", "id": RUNTIME_SA},
        }]

    def __call__(self, url, label, payload=None):
        if url.startswith(LOCKBOX):
            assert payload is None
            if url.startswith(LOCKBOX + "?"):
                return {"secrets": [self.dexie_secret] if self.dexie_secret else []}
            assert url.startswith(LOCKBOX + "/dexiesecret:listAccessBindings?")
            return {"accessBindings": self.lockbox_bindings}
        return super().__call__(url, label, payload)


class DexieTokenOperatorContracts(unittest.TestCase):
    def test_preview_apply_and_rollback_preserve_auth_and_fallback(self):
        cloud = DexieTokenCloud()
        baseline = deepcopy(cloud.spec)
        auth_version = deepcopy(cloud.versions[0])
        cloud.execute("preview", "dexie-tokens", "")
        with self.assertRaisesRegex(WebHostingError, "confirmation"):
            cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS_ROLLBACK)
        self.assertEqual(cloud.writes, [])

        cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS)
        self.assertEqual([url for url, _ in cloud.writes], [VERSIONS, GATEWAYS + "/gateway1"])
        version = cloud.writes[0][1]
        self.assertEqual(version["tag"], [DEXIE_TOKEN_TAG])
        self.assertEqual(version["serviceAccountId"], RUNTIME_SA)
        self.assertEqual(version["environment"]["MEZFIT_AUTH_HOSTS"],
                         auth_version["environment"]["MEZFIT_AUTH_HOSTS"])
        self.assertEqual(version["secrets"], [
            {"id": SECRET, "versionId": SECRET_VERSION, "key": "session_secret",
             "environmentVariable": "MEZFIT_BROWSER_SESSION_SECRET"},
            {"id": "dexiesecret", "versionId": "dexieversion", "key": "client_id",
             "environmentVariable": "DEXIE_CLOUD_CLIENT_ID"},
            {"id": "dexiesecret", "versionId": "dexieversion", "key": "client_secret",
             "environmentVariable": "DEXIE_CLOUD_CLIENT_SECRET"},
        ])
        paths = deepcopy(cloud.spec["paths"])
        self.assertEqual(paths.pop(DEXIE_TOKEN_PATH), {"post": {"x-yc-apigateway-integration": {
            "type": "cloud_functions", "function_id": "function1", "service_account_id": SA,
            "tag": DEXIE_TOKEN_TAG, "payload_format_version": "1.0",
        }}})
        self.assertEqual(paths, baseline["paths"])
        self.assertEqual(cloud.versions[0], auth_version)

        cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS)
        cloud.dexie_secret = None
        cloud.execute("preview", "dexie-tokens-rollback", "")
        self.assertEqual(len(cloud.writes), 2)
        cloud.execute("apply", "dexie-tokens-rollback", DEXIE_TOKENS_ROLLBACK)
        cloud.execute("apply", "dexie-tokens-rollback", DEXIE_TOKENS_ROLLBACK)
        self.assertEqual(len(cloud.writes), 3)
        self.assertEqual(cloud.spec, baseline)
        self.assertEqual(cloud.versions[0]["tags"], [TAG])

    def test_drift_missing_config_and_public_invocation_fail_before_writes(self):
        for failure in ("gateway", "auth", "lockbox", "binding", "public"):
            with self.subTest(failure=failure):
                cloud = DexieTokenCloud()
                if failure == "gateway":
                    cloud.spec["paths"]["/auth/session"]["get"]["x-yc-apigateway-integration"]["tag"] = "wrong"
                elif failure == "auth":
                    cloud.versions[0]["description"] = "unknown package"
                elif failure == "lockbox":
                    cloud.dexie_secret = None
                elif failure == "binding":
                    cloud.lockbox_bindings = []
                else:
                    cloud.bindings.append({"roleId": "functions.functionInvoker",
                                           "subject": {"type": "system", "id": "allUsers"}})
                with self.assertRaises(WebHostingError):
                    cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS)
                self.assertEqual(cloud.writes, [])

    def test_gateway_retry_reuses_private_version_after_interruption(self):
        cloud = DexieTokenCloud()
        update = cloud.update

        def interrupted(*args, **kwargs):
            raise WebHostingError("Gateway write interrupted")

        cloud.update = interrupted
        with self.assertRaisesRegex(WebHostingError, "interrupted"):
            cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS)
        self.assertNotIn(DEXIE_TOKEN_PATH, cloud.spec["paths"])
        self.assertEqual([url for url, _ in cloud.writes], [VERSIONS])
        cloud.update = update
        cloud.execute("apply", "dexie-tokens", DEXIE_TOKENS)
        self.assertEqual([url for url, _ in cloud.writes], [VERSIONS, GATEWAYS + "/gateway1"])
