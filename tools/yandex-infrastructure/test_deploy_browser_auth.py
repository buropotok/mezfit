"""Source-code contract tests for the Yandex Telegram browser login operator."""

import json
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from zipfile import ZipFile
from io import BytesIO

from deploy_browser_auth import (
    FUNCTIONS, TAG, VERSIONS, execute, source_package,
    version_secrets, validate_operation,
)
from web_hosting import GATEWAYS, WebHostingError, bucket_name, gateway_spec

FOLDER = "b1ggoodfolderid"
SA = "ajeexampleaccount"
RUNTIME_SA = "ajeruntimeaccount"
SECRET = "e1abexample"
SECRET_VERSION = "e2abexample"
DOMAIN = "d5example.a1.apigw.yandexcloud.net"


class FakeCloud:
    def __init__(self):
        self.function = None
        self.gateway = {
            "id": "gateway1", "name": "mezfit-web", "folderId": FOLDER,
            "domain": DOMAIN, "status": "ACTIVE", "attachedDomains": [],
        }
        self.spec = gateway_spec(bucket_name(FOLDER))
        self.versions = []
        self.bindings = []
        self.writes = []

    def __call__(self, url, label, payload=None):
        if payload is not None:
            self.writes.append((url, payload))
            if url == FUNCTIONS:
                self.function = {"id": "function1", "name": "mezfit-browser-login",
                                 "folderId": FOLDER, "status": "ACTIVE"}
                return self.operation({"id": "function1"})
            if url.endswith(":updateAccessBindings"):
                for change in payload["accessBindingDeltas"]:
                    self.bindings.append(change["accessBinding"])
                return self.operation({})
            if url == VERSIONS:
                self.versions = [{
                    "id": "version1", "functionId": "function1",
                    "description": payload["description"],
                    "runtime": payload["runtime"], "entrypoint": payload["entrypoint"],
                    "serviceAccountId": payload["serviceAccountId"],
                    "environment": payload["environment"],
                    "secrets": payload["secrets"],
                    "tags": payload["tag"],
                    "status": "ACTIVE",
                }]
                return self.operation({"id": "version1"})
            raise AssertionError(f"Unexpected write: {url}")
        if url.startswith(GATEWAYS + "?"):
            return {"apiGateways": [self.gateway.copy()]}
        if url == GATEWAYS + "/gateway1:spec":
            return {"openapiSpec": json.dumps(self.spec)}
        if url.startswith(FUNCTIONS + "?"):
            return {"functions": [self.function.copy()] if self.function else []}
        if url.startswith(VERSIONS + "?"):
            return {"versions": list(self.versions)}
        if url.endswith(":listAccessBindings?"):
            raise AssertionError("Expected query parameters")
        if ":listAccessBindings?" in url:
            return {"accessBindings": list(self.bindings)}
        raise AssertionError(f"Unexpected read: {url} ({label})")

    def update(self, url, label, payload, method):
        assert method == "PATCH"
        assert url == GATEWAYS + "/gateway1"
        assert payload["updateMask"] == "openapiSpec"
        self.writes.append((url, payload))
        self.spec = json.loads(payload["openapiSpec"])
        return self.operation({})

    @staticmethod
    def operation(response):
        return {"id": "operation1", "done": True, "response": response}

    def execute(self, mode, action, secret=SECRET, version=SECRET_VERSION):
        with patch.dict("os.environ", {"YC_DEPLOY_SA_ID": SA}):
            execute(mode, action, FOLDER, SA, RUNTIME_SA, secret, version,
                    self, self.update, sleep=lambda _: None)


class BrowserOperatorContracts(TestCase):
    def test_invalid_operation_blocks_bootstrap_preflight(self):
        with self.assertRaisesRegex(WebHostingError, "Unknown browser auth operation"):
            validate_operation("apply", "unknown")
        with self.assertRaisesRegex(WebHostingError, "Unknown browser auth operation"):
            validate_operation("invalid", "prepare")
        validate_operation("preview", "prepare")
        validate_operation("apply", "activate")

    def test_function_archive_is_reproducible_and_contains_only_runtime_files(self):
        archive, description = source_package()
        self.assertEqual(source_package(), (archive, description))
        self.assertRegex(description, "^MezFit browser OIDC code SHA256:[a-f0-9]{64}$")
        with ZipFile(BytesIO(archive)) as file:
            self.assertEqual(sorted(file.namelist()), ["index.js", "package.json"])
            self.assertIn(b"exports.handler = handler;", file.read("index.js"))
            self.assertIn(b'"type": "commonjs"', file.read("package.json"))

    def test_preview_is_read_only_without_lockbox_secrets(self):
        cloud = FakeCloud()
        cloud.execute("preview", "prepare", secret="", version="")
        self.assertEqual(cloud.writes, [])

    def test_each_action_rejects_invalid_mode_before_write(self):
        cloud = FakeCloud()
        for action in ("prepare", "activate"):
            with self.subTest(action=action):
                with self.assertRaisesRegex(WebHostingError, "Unknown browser auth operation"):
                    cloud.execute("invalid", action)
        self.assertEqual(cloud.writes, [])

    def test_apply_requires_pinned_lockbox_secret_and_version(self):
        cloud = FakeCloud()
        with self.assertRaisesRegex(WebHostingError, "Lockbox"):
            cloud.execute("apply", "prepare", secret="", version="")
        self.assertEqual(cloud.writes, [])

    def test_prepare_creates_only_private_function_invoker_and_pinned_version(self):
        cloud = FakeCloud()
        cloud.execute("apply", "prepare")
        cloud.execute("apply", "prepare")
        self.assertEqual(len(cloud.writes), 3)
        self.assertEqual(cloud.writes[0][0], FUNCTIONS)
        self.assertTrue(cloud.writes[1][0].endswith(":updateAccessBindings"))
        self.assertEqual(cloud.writes[1][1]["accessBindingDeltas"], [{
            "action": "ADD", "accessBinding": {
                "roleId": "functions.functionInvoker",
                "subject": {"type": "serviceAccount", "id": SA},
            },
        }])
        self.assertEqual(cloud.writes[2][0], VERSIONS)
        self.assertEqual(cloud.writes[2][1]["runtime"], "nodejs22")
        self.assertEqual(cloud.writes[2][1]["serviceAccountId"], RUNTIME_SA)
        self.assertEqual(cloud.writes[2][1]["tag"], [TAG])
        self.assertEqual(cloud.writes[2][1]["secrets"], version_secrets(SECRET, SECRET_VERSION))
        self.assertEqual(cloud.spec, gateway_spec(bucket_name(FOLDER)))

    def test_activation_adds_only_exact_four_auth_routes_and_reuses(self):
        cloud = FakeCloud()
        cloud.execute("apply", "prepare")
        cloud.execute("preview", "activate")
        self.assertEqual(len(cloud.writes), 3)
        cloud.execute("apply", "activate")
        cloud.execute("apply", "activate")
        self.assertEqual(len(cloud.writes), 4)
        self.assertEqual(set(cloud.spec["paths"]) -
                         set(gateway_spec(bucket_name(FOLDER))["paths"]),
                         {"/auth/start", "/auth/callback", "/auth/session", "/auth/logout"})
        self.assertEqual(cloud.spec["paths"]["/api"], gateway_spec(bucket_name(FOLDER))["paths"]["/api"])
        self.assertEqual(cloud.spec["paths"]["/auth/callback"]["get"]
                         ["x-yc-apigateway-integration"]["function_id"], "function1")

    def test_gateway_drift_or_public_invocation_fails_before_writes(self):
        cloud = FakeCloud()
        cloud.execute("apply", "prepare")
        cloud.spec["paths"]["/api"]["get"]["x-yc-apigateway-integration"]["http_code"] = 200
        with self.assertRaises(WebHostingError):
            cloud.execute("apply", "activate")
        self.assertEqual(len(cloud.writes), 3)

        blocked = FakeCloud()
        blocked.function = {"id": "function1", "name": "mezfit-browser-login",
                            "folderId": FOLDER}
        blocked.bindings = [{"roleId": "functions.functionInvoker",
                             "subject": {"type": "system", "id": "allUsers"}}]
        with self.assertRaisesRegex(WebHostingError, "Public access"):
            blocked.execute("apply", "prepare")
        self.assertEqual(blocked.writes, [])

    def test_missing_version_or_other_secret_version_blocks_activation(self):
        cloud = FakeCloud()
        cloud.execute("apply", "prepare")
        with self.assertRaisesRegex(WebHostingError, "expected ACTIVE|Expected ACTIVE"):
            cloud.execute("apply", "activate", version="other")
        self.assertEqual(len(cloud.writes), 3)
