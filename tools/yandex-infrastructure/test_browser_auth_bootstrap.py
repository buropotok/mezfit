"""GitHub Secrets -> isolated runtime SA + protected Yandex Lockbox contracts."""

from copy import deepcopy
import unittest
from unittest.mock import patch

from browser_auth_bootstrap import (
    IAM_SERVICE_ACCOUNTS, LOCKBOX, RUNTIME_ACCOUNT_NAME, SECRET_NAME,
    EXPECTED_KEYS, RUNTIME_PAYLOAD_ROLE, bootstrap,
)
from web_hosting import WebHostingError

FOLDER = "b1ggoodfolderid"
CLIENT_ID = "8635045061"
CLIENT_SECRET = "a-github-only-telegram-secret-with-many-bytes"


class FakeBootstrapCloud:
    def __init__(self):
        self.accounts = []
        self.secrets = []
        self.bindings = []
        self.writes = []
        self.hidden_payload = None

    def __call__(self, url, label, payload=None):
        if payload is not None:
            self.writes.append((url, deepcopy(payload)))
            if url == IAM_SERVICE_ACCOUNTS:
                self.accounts.append({
                    "id": "ajeruntimeaccount", "name": RUNTIME_ACCOUNT_NAME, "folderId": FOLDER,
                })
                return self.operation({"id": "ajeruntimeaccount"})
            if url == LOCKBOX:
                self.hidden_payload = deepcopy(payload["versionPayloadEntries"])
                self.secrets.append({
                    "id": "e1lockboxsecret", "name": SECRET_NAME, "folderId": FOLDER,
                    "status": "ACTIVE", "deletionProtection": True,
                    "currentVersion": {
                        "id": "e2pinnedversion", "secretId": "e1lockboxsecret",
                        "status": "ACTIVE", "payloadEntryKeys": list(EXPECTED_KEYS),
                    },
                })
                return self.operation({"id": "e1lockboxsecret"})
            if url == LOCKBOX + "/e1lockboxsecret:updateAccessBindings":
                self.bindings.extend(deepcopy(item["accessBinding"])
                                     for item in payload["accessBindingDeltas"])
                return self.operation({})
            raise AssertionError(f"Unexpected write {url}")
        if url.startswith(IAM_SERVICE_ACCOUNTS + "?"):
            return {"serviceAccounts": deepcopy(self.accounts)}
        if url.startswith(LOCKBOX + "?"):
            return {"secrets": deepcopy(self.secrets)}
        if url.startswith(LOCKBOX + "/e1lockboxsecret:listAccessBindings?"):
            return {"accessBindings": deepcopy(self.bindings)}
        raise AssertionError(f"Unexpected read {url} ({label})")

    @staticmethod
    def operation(response):
        return {"id": "op123", "done": True, "response": response}

    def bootstrap(self, mode="preview", action="prepare", secret=CLIENT_SECRET):
        return bootstrap(mode, action, FOLDER, self, sleep=lambda _: None,
                         client_id=CLIENT_ID, client_secret=secret)


class BrowserAuthBootstrapContracts(unittest.TestCase):
    def test_preview_is_strictly_read_only_and_does_not_need_credentials(self):
        cloud = FakeBootstrapCloud()
        self.assertEqual(bootstrap("preview", "prepare", FOLDER, cloud,
                                   client_id="", client_secret=""),
                         ("", "", ""))
        self.assertEqual(cloud.writes, [])

    def test_first_apply_creates_runtime_identity_secret_and_narrow_access(self):
        cloud = FakeBootstrapCloud()
        values = cloud.bootstrap("apply")
        self.assertEqual(values, ("ajeruntimeaccount", "e1lockboxsecret", "e2pinnedversion"))
        self.assertEqual(len(cloud.writes), 3)
        self.assertEqual([url for url, _ in cloud.writes], [
            IAM_SERVICE_ACCOUNTS, LOCKBOX,
            LOCKBOX + "/e1lockboxsecret:updateAccessBindings",
        ])
        self.assertEqual(cloud.writes[0][1]["name"], RUNTIME_ACCOUNT_NAME)
        lockbox_create = cloud.writes[1][1]
        self.assertTrue(lockbox_create["deletionProtection"])
        self.assertTrue(lockbox_create["createVersion"])
        fields = {value["key"]: value["textValue"]
                  for value in lockbox_create["versionPayloadEntries"]}
        self.assertEqual(set(fields), EXPECTED_KEYS)
        self.assertEqual(fields["client_id"], CLIENT_ID)
        self.assertEqual(fields["client_secret"], CLIENT_SECRET)
        self.assertGreaterEqual(len(fields["session_secret"]), 43)
        self.assertNotEqual(fields["session_secret"], CLIENT_SECRET)
        self.assertEqual(cloud.writes[2][1]["accessBindingDeltas"], [{
            "action": "ADD",
            "accessBinding": {
                "roleId": RUNTIME_PAYLOAD_ROLE,
                "subject": {"type": "serviceAccount", "id": "ajeruntimeaccount"},
            },
        }])

    def test_reruns_are_idempotent_and_never_rotate_existing_credentials(self):
        cloud = FakeBootstrapCloud()
        cloud.bootstrap("apply")
        original_payload = deepcopy(cloud.hidden_payload)
        self.assertEqual(cloud.bootstrap("apply", secret="completely-new-github-secret"),
                         ("ajeruntimeaccount", "e1lockboxsecret", "e2pinnedversion"))
        self.assertEqual(len(cloud.writes), 3)
        self.assertEqual(cloud.hidden_payload, original_payload)

    def test_activate_is_read_only_and_requires_completed_bootstrap(self):
        cloud = FakeBootstrapCloud()
        with self.assertRaisesRegex(WebHostingError, "Prepare first"):
            cloud.bootstrap("apply", action="activate")
        self.assertEqual(cloud.writes, [])
        cloud.bootstrap("apply")
        self.assertEqual(cloud.bootstrap("preview", "activate"),
                         ("ajeruntimeaccount", "e1lockboxsecret", "e2pinnedversion"))
        self.assertEqual(len(cloud.writes), 3)

    def test_missing_github_secret_blocks_all_creation(self):
        for secret in ("", "bad"):
            with self.subTest(secret=secret):
                cloud = FakeBootstrapCloud()
                with self.assertRaisesRegex(WebHostingError, "TELEGRAM_LOGIN_CLIENT_SECRET"):
                    cloud.bootstrap("apply", secret=secret)
                self.assertEqual(cloud.writes, [])

    def test_existing_conflicting_lockbox_is_not_replaced(self):
        cloud = FakeBootstrapCloud()
        cloud.bootstrap("apply")
        cloud.secrets[0]["deletionProtection"] = False
        with self.assertRaisesRegex(WebHostingError, "unexpected configuration"):
            cloud.bootstrap("apply")
        self.assertEqual(len(cloud.writes), 3)

    def test_unknown_direct_payload_viewer_is_rejected(self):
        cloud = FakeBootstrapCloud()
        cloud.bootstrap("apply")
        cloud.bindings.append({
            "roleId": RUNTIME_PAYLOAD_ROLE,
            "subject": {"type": "serviceAccount", "id": "ajeotheraccount"},
        })
        with self.assertRaisesRegex(WebHostingError, "Unexpected Lockbox payload viewer"):
            cloud.bootstrap("apply")
        self.assertEqual(len(cloud.writes), 3)

    def test_public_lockbox_binding_is_rejected(self):
        cloud = FakeBootstrapCloud()
        cloud.bootstrap("apply")
        cloud.bindings.append({
            "roleId": "lockbox.viewer",
            "subject": {"type": "system", "id": "allUsers"},
        })
        with self.assertRaisesRegex(WebHostingError, "Public Lockbox"):
            cloud.bootstrap("apply")
        self.assertEqual(len(cloud.writes), 3)

    def test_partial_failure_is_resumable_without_recreating_sa(self):
        cloud = FakeBootstrapCloud()
        cloud.bootstrap("apply")
        cloud.bindings.clear()
        cloud.bootstrap("apply")
        self.assertEqual(len(cloud.writes), 4)
        self.assertEqual(cloud.writes[-1][0],
                         LOCKBOX + "/e1lockboxsecret:updateAccessBindings")


if __name__ == "__main__":
    unittest.main()
