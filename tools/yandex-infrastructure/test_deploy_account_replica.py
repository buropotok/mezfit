"""Gateway, ownership and deployment wiring contracts for the replica."""

from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from deploy_account_replica import MANAGED, binding, configure_route, database_config, ensure, ensure_binding, pinned_secret
from deploy_browser_auth import check_gateway
from test_deploy_browser_auth import FOLDER, SA, FakeCloud
from web_hosting import (
    ACCOUNT_REPLICA_PATH, FUNCTIONS, GATEWAYS, NAME_ACCOUNT_REPLICA_FUNCTION,
    WebHostingError, account_replica_route, browser_auth_gateway_spec, bucket_name,
    normalize_gateway_readback, verify_gateway,
)


class GatewayCloud(FakeCloud):
    def __init__(self):
        super().__init__()
        self.function = {"id": "function1", "folderId": FOLDER, "name": "mezfit-browser-login", "status": "ACTIVE"}
        self.receiver = {"id": "function2", "folderId": FOLDER, "name": NAME_ACCOUNT_REPLICA_FUNCTION,
                         "status": "ACTIVE", "description": MANAGED}

    def __call__(self, url, label, payload=None):
        if url.startswith(FUNCTIONS + "?") and payload is None:
            return {"functions": [self.function, self.receiver]}
        return super().__call__(url, label, payload)


class AccountReplicaDeployContracts(unittest.TestCase):
    def test_adds_exact_route_and_preserves_the_browser_gateway(self):
        cloud = GatewayCloud()
        cloud.spec = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA, popup=True, dexie_tokens=True)
        original = deepcopy(cloud.spec)
        route = account_replica_route("function2", SA)

        def update(url, label, payload):
            return cloud.update(url, label, payload, "PATCH")

        with patch.dict("os.environ", {"YC_DEPLOY_SA_ID": SA}):
            configure_route(cloud, update, FOLDER, cloud.gateway, original, route)
            verify_gateway(cloud.gateway, FOLDER, bucket_name(FOLDER), cloud)
            configure_route(cloud, update, FOLDER, cloud.gateway, deepcopy(cloud.spec), route)
            with self.assertRaisesRegex(WebHostingError, "disable it before changing browser-auth"):
                check_gateway(cloud.gateway, cloud, FOLDER)
        self.assertEqual(len(cloud.writes), 1)
        updated = json.loads(cloud.writes[0][1]["openapiSpec"])
        self.assertEqual(updated["paths"].pop(ACCOUNT_REPLICA_PATH), route)
        self.assertEqual(set(route), {"post"})
        self.assertEqual(updated, normalize_gateway_readback(original, cloud.gateway["domain"]))
        self.assertEqual(cloud.writes[0][0], GATEWAYS + "/" + cloud.gateway["id"])

    def test_unexpected_or_concurrently_changed_gateway_is_never_overwritten(self):
        cloud = GatewayCloud()
        original = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA, popup=True, dexie_tokens=True)
        cloud.spec = deepcopy(original)
        cloud.spec["paths"][ACCOUNT_REPLICA_PATH] = account_replica_route("function1", SA)
        with patch.dict("os.environ", {"YC_DEPLOY_SA_ID": SA}):
            with self.assertRaises(WebHostingError):
                configure_route(cloud, cloud.update, FOLDER, cloud.gateway, original,
                                account_replica_route("function2", SA))
            cloud.spec = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA, popup=False, dexie_tokens=True)
            with self.assertRaisesRegex(WebHostingError, "changed concurrently"):
                configure_route(cloud, cloud.update, FOLDER, cloud.gateway, original,
                                account_replica_route("function2", SA))
        self.assertEqual(cloud.writes, [])

    def test_private_function_and_scoped_binding_are_reused_after_partial_apply(self):
        cloud = FakeCloud()

        def api(url, label, payload=None):
            if url == FUNCTIONS and payload is not None:
                cloud.writes.append((url, payload))
                cloud.function = {**payload, "id": "function2", "status": "ACTIVE"}
                return cloud.operation({"id": cloud.function["id"]})
            return cloud(url, label, payload)

        function = ensure(api, FUNCTIONS, FOLDER, "functions", NAME_ACCOUNT_REPLICA_FUNCTION)
        grant = binding("functions.functionInvoker", SA)
        target = f"{FUNCTIONS}/{function['id']}:updateAccessBindings"
        ensure_binding(cloud, target, lambda: cloud.bindings.copy(), grant, "Scoped invoke")
        ensure_binding(cloud, target, lambda: cloud.bindings.copy(), grant, "Scoped invoke")
        self.assertEqual(ensure(api, FUNCTIONS, FOLDER, "functions", NAME_ACCOUNT_REPLICA_FUNCTION), function)
        self.assertEqual([url for url, _ in cloud.writes], [FUNCTIONS, target])
        self.assertEqual(cloud.bindings, [grant])

    def test_required_protection_and_pinned_region(self):
        database = {
            "id": "database1", "status": "RUNNING", "locationId": "ru-central1",
            "deletionProtection": True, "serverlessDatabase": {"storageSizeLimit": "1073741824"},
            "endpoint": "grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/cloud1/database1",
        }
        self.assertEqual(database_config(database),
                         ("grpcs://ydb.serverless.yandexcloud.net:2135", "/ru-central1/cloud1/database1"))
        with self.assertRaises(WebHostingError):
            database_config(database | {"locationId": "kz1"})
        secret = {"id": "secret1", "status": "ACTIVE", "deletionProtection": True, "currentVersion": {
            "secretId": "secret1", "id": "version1", "status": "ACTIVE",
            "payloadEntryKeys": ["replication_secret"],
        }}
        self.assertEqual(pinned_secret(secret)[0]["versionId"], "version1")
        with self.assertRaises(WebHostingError):
            pinned_secret(secret | {"deletionProtection": False})

    def test_production_workflow_only_runs_on_main_push_with_shared_gateway_lock(self):
        workflows = Path(__file__).resolve().parents[2] / ".github" / "workflows"
        apply = (workflows / "deploy-mezfit-account-replica.yml").read_text()
        self.assertIn("push:\n    branches: [main]", apply)
        self.assertIn("github.repository == 'buropotok/mezfit'", apply)
        self.assertIn("github.ref == 'refs/heads/main'", apply)
        self.assertNotIn("workflow_dispatch", apply)
        self.assertNotIn("pull_request", apply)
        self.assertNotIn("confirm", apply)
        self.assertIn("secrets.MEZFIT_ACCOUNT_REPLICATION_SECRET", apply)
        for workflow in ("deploy-mezfit-account-replica", "prepare-mezfit-browser-login",
                         "prepare-mezfit-dual-domains", "prepare-yandex-web"):
            definition = (workflows / (workflow + ".yml")).read_text()
            self.assertIn("group: mezfit-yandex-web-gateway", definition)
            self.assertIn("cancel-in-progress: false", definition)
