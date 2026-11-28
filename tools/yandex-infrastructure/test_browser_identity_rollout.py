"""Browser identity rollout contracts without live Yandex calls."""

import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import deploy_account_replica as deploy
from web_hosting import WebHostingError


class BrowserIdentityRolloutTests(unittest.TestCase):
    def setUp(self):
        self.gateway = {"id": "gateway"}
        self.spec = {"paths": {}}
        self.versions = [
            {
                "id": f"old{n}", "status": "ACTIVE", "tags": [tag], "functionId": "browserfn",
                "runtime": "nodejs22", "entrypoint": "index.handler", "serviceAccountId": "browserruntime",
                "description": "MezFit browser OIDC code SHA256:" + "1" * 64,
                "resources": {"memory": "268435456"}, "executionTimeout": "20s",
                "environment": {"MEZFIT_AUTH_HOSTS": "mezfit.online"},
                "secrets": [{"id": f"binding{n}", "versionId": "pinned", "key": "example"}],
            }
            for n, tag in enumerate((deploy.BROWSER_AUTH_TAG, deploy.DEXIE_TOKEN_TAG))
        ]
        self.writes = []
        self.total = self.ready = 3
        self.transaction = Mock()
        self.transaction.__enter__ = Mock(return_value=self.transaction)
        self.transaction.__exit__ = Mock(return_value=False)
        self.transaction.execute.side_effect = self.query
        self.session = Mock()
        self.session.transaction.return_value = self.transaction
        pool = Mock()
        pool.retry_operation_sync.side_effect = lambda read, **_: read(self.session)
        sdk = SimpleNamespace(
            AccessTokenCredentials=Mock(), BaseRequestSettings=Mock(),
            SerializableReadWrite=Mock(), RetrySettings=Mock(),
        )
        self.enterContext(patch.dict(sys.modules, {
            "ydb": sdk, "replica_store": SimpleNamespace(connect=Mock(return_value=(pool, Mock(), "/test")),
                                                       verify_schema=Mock()),
        }))
        self.enterContext(patch.object(deploy, "find", return_value={"id": "browserfn", "status": "ACTIVE"}))
        self.enterContext(patch.object(deploy, "source_package",
                                      return_value=(b"browser-package", "MezFit browser OIDC code SHA256:" + "2" * 64)))
        self.enterContext(patch.object(deploy, "function_version_list", side_effect=lambda *_: self.versions))
        self.enterContext(patch.object(deploy, "function_bindings", return_value=[]))
        self.enterContext(patch.object(deploy, "has_gateway_invoker", return_value=True))
        self.enterContext(patch.object(deploy, "gateway_state", return_value=(self.gateway, self.spec)))
        self.enterContext(patch.object(deploy, "await_operation", side_effect=lambda _, result, __: result))
        self.enterContext(patch("builtins.print"))

    def query(self, statement, **_):
        if "AS total" in statement:
            return [SimpleNamespace(rows=[SimpleNamespace(total=self.total, ready=self.ready)])]
        self.assertIn("VIEW account_external_telegram_idx", statement)
        return [SimpleNamespace(rows=[])]

    def api(self, url, _label, payload=None):
        if url == deploy.RUNTIME_IAM_TOKEN_URL:
            self.assertEqual(payload, {"serviceAccountId": "browserruntime"})
            return {"iamToken": "fixture"}
        self.writes.append(url)
        if url == deploy.VERSIONS:
            version = {k: v for k, v in payload.items() if k not in ("tag", "content")}
            version.update(id=f"next{len(self.versions)}", status="ACTIVE", tags=payload["tag"])
            self.versions.append(version)
            return {"id": version["id"]}
        version_id = url.removeprefix(deploy.VERSIONS + "/").removesuffix(":setTag")
        tag = payload["tag"]
        for version in self.versions:
            if tag in version["tags"]:
                version["tags"].remove(tag)
            if version["id"] == version_id:
                version["tags"].append(tag)
        return {}

    def activate(self):
        deploy.activate_browser_identity(self.api, "folder", self.gateway, self.spec, "deployer",
                                         "browserruntime", "grpcs://example", "/ru-central1/folder/database")

    def test_incomplete_replica_leaves_all_serving_versions_in_place(self):
        self.ready = 2
        with self.assertRaisesRegex(WebHostingError, "Incomplete account identities"):
            self.activate()
        self.assertEqual(self.writes, [])

    def test_prepares_all_versions_before_enabling_and_reuses_them(self):
        self.activate()
        self.assertEqual(self.writes[:2], [deploy.VERSIONS, deploy.VERSIONS])
        self.assertEqual(len(self.writes), 4)
        for n, tag in enumerate((deploy.BROWSER_AUTH_TAG, deploy.DEXIE_TOKEN_TAG)):
            active = deploy.select_tagged_version(self.versions, tag)
            self.assertEqual(active["secrets"], self.versions[n]["secrets"])
            self.assertEqual(active["environment"]["MEZFIT_BROWSER_YDB_IDENTITY_ENABLED"], "true")
        self.activate()
        self.assertEqual(len(self.writes), 4)
