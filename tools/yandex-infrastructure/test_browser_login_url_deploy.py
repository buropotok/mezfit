"""Verify the exact LoginUrl deployment and coexistence with Gateway writers."""

from copy import deepcopy
import unittest
from unittest.mock import patch

from deploy_browser_auth import (
    DEXIE_TOKEN_TAG, LOGIN_URL, LOGIN_URL_ROLLBACK, TAG, VERSIONS, nonce_bucket_name, version_secrets,
)
from deploy_account_replica import configure_route
from test_deploy_account_replica import GatewayCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA, SECRET, SECRET_VERSION
from web_hosting import (
    ACCOUNT_REPLICA_PATH, GATEWAYS, LOGIN_URL_PATH, LOGIN_URL_TAG, WebHostingError,
    account_replica_route, browser_auth_gateway_spec, browser_login_url_fallback,
    browser_login_url_route, bucket_name, normalize_gateway_readback, verify_gateway,
)


class LoginUrlCloud(GatewayCloud):
    def __init__(self):
        super().__init__()
        self.gateway["logOptions"] = {"disabled": True}
        self.spec = browser_auth_gateway_spec(
            bucket_name(FOLDER), "function1", SA, popup=True, dexie_tokens=True,
        )
        self.spec["paths"][ACCOUNT_REPLICA_PATH] = account_replica_route("function2", SA)
        self.bindings = [{"roleId": "functions.functionInvoker",
                          "subject": {"type": "serviceAccount", "id": SA}}]
        self.versions = [
            {"id": "oidc1", "status": "ACTIVE", "tags": [TAG], "serviceAccountId": RUNTIME_SA,
             "environment": {"MEZFIT_BROWSER_CHALLENGE_BUCKET": nonce_bucket_name(FOLDER)},
             "secrets": version_secrets(SECRET, SECRET_VERSION)},
            {"id": "dexie1", "status": "ACTIVE", "tags": [DEXIE_TOKEN_TAG],
             "secrets": [version_secrets(SECRET, SECRET_VERSION)[2]]},
        ]

    def __call__(self, url, label, payload=None):
        if url == GATEWAYS + "/gateway1":
            return deepcopy(self.gateway)
        if url == VERSIONS and payload:
            self.writes.append((url, payload))
            version = {**payload, "id": "loginurl1", "status": "ACTIVE", "tags": payload["tag"]}
            self.versions.append(version)
            return self.operation({"id": version["id"]})
        return super().__call__(url, label, payload)


class LoginUrlDeployment(unittest.TestCase):
    def setUp(self):
        self.cloud = LoginUrlCloud()
        self.patchers = [
            patch("deploy_browser_auth.verified_gateway_domains", return_value={"mezfit.online"}),
            patch("deploy_browser_auth.ensure_nonce_bucket"),
            patch("deploy_browser_auth.login_url_secret", return_value={
                "id": "lockbox1", "versionId": "pin1", "key": "login_url_key",
                "environmentVariable": "MEZFIT_TELEGRAM_LOGIN_URL_KEY",
            }),
        ]
        for item in self.patchers:
            item.start()
            self.addCleanup(item.stop)

    def test_preview_apply_repeat_and_rollback_leave_replica_and_serving_oidc_intact(self):
        cloud = self.cloud
        original = normalize_gateway_readback(cloud.spec, cloud.gateway["domain"])
        serving = deepcopy(cloud.versions)
        cloud.execute("preview", "login-url", "")
        self.assertEqual(cloud.writes, [])

        cloud.execute("apply", "login-url", LOGIN_URL)
        self.assertEqual([url for url, _ in cloud.writes], [VERSIONS, GATEWAYS + "/gateway1"])
        self.assertEqual(cloud.versions[:2], serving)
        self.assertEqual(cloud.versions[2]["tags"], [LOGIN_URL_TAG])
        self.assertEqual(cloud.versions[2]["logOptions"], {"disabled": True})
        active = normalize_gateway_readback(cloud.spec, cloud.gateway["domain"])
        self.assertEqual(active["paths"].pop(LOGIN_URL_PATH), browser_login_url_route("function1", SA))
        self.assertEqual(active, original)
        cloud.execute("apply", "login-url", LOGIN_URL)
        self.assertEqual(len(cloud.writes), 2)
        cloud.execute("apply", "login-url-rollback", LOGIN_URL_ROLLBACK)
        self.assertEqual(cloud.spec["paths"].pop(LOGIN_URL_PATH), browser_login_url_fallback())
        self.assertEqual(normalize_gateway_readback(cloud.spec, cloud.gateway["domain"]), original)

    def test_logging_or_gateway_drift_stops_before_mutations(self):
        cloud = self.cloud
        cloud.gateway["logOptions"] = {"disabled": False}
        with self.assertRaisesRegex(WebHostingError, "logging"):
            cloud.execute("apply", "login-url", LOGIN_URL)
        cloud.gateway["logOptions"]["disabled"] = True
        cloud.spec["paths"][LOGIN_URL_PATH] = browser_login_url_route("otherfunc", SA)
        with self.assertRaisesRegex(WebHostingError, "refusing"):
            cloud.execute("apply", "login-url", LOGIN_URL)
        self.assertEqual(cloud.writes, [])

    def test_account_replica_writer_preserves_active_and_rollback_paths(self):
        for route in (browser_login_url_route("function1", SA), browser_login_url_fallback()):
            with self.subTest(route=route):
                cloud = LoginUrlCloud()
                cloud.spec["paths"].pop(ACCOUNT_REPLICA_PATH)
                cloud.spec["paths"][LOGIN_URL_PATH] = route

                def update(url, label, payload):
                    return cloud.update(url, label, payload, "PATCH")

                with patch.dict("os.environ", {"YC_DEPLOY_SA_ID": SA}):
                    configure_route(cloud, update, FOLDER, cloud.gateway, deepcopy(cloud.spec),
                                    account_replica_route("function2", SA))
                    verify_gateway(cloud.gateway, FOLDER, bucket_name(FOLDER), cloud)
                self.assertEqual(cloud.spec["paths"][LOGIN_URL_PATH], route)

    def test_old_full_spec_writer_stops_when_login_url_is_deployed(self):
        cloud = self.cloud
        cloud.spec["paths"].pop(ACCOUNT_REPLICA_PATH)
        cloud.spec["paths"][LOGIN_URL_PATH] = browser_login_url_route("function1", SA)
        with self.assertRaisesRegex(WebHostingError, "LoginUrl route is managed separately"):
            cloud.execute("apply", "activate", "ACTIVATE_MEZFIT_BROWSER_LOGIN")
        self.assertEqual(cloud.writes, [])
