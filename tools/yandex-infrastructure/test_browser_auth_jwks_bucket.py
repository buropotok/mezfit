"""Contracts for enabling the existing private JWKS mirror in browser login."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import unittest

import jwks_mirror
from deploy_browser_auth import (
    DIAGNOSTICS_FINGERPRINT, DIRECT_POPUP_FINGERPRINT, POPUP_MIRROR, POPUP_ROLLBACK,
    PRE_POPUP_TAG, TAG, VERSIONS, nonce_bucket_name,
)
from test_browser_auth_diagnostics_upgrade import UpgradeCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA
from web_hosting import STORAGE, WebHostingError, browser_auth_gateway_spec, bucket_name


class MirrorCloud(UpgradeCloud):
    def __init__(self):
        super().__init__()
        diagnostics = self.versions[0]
        diagnostics["description"] = DIAGNOSTICS_FINGERPRINT
        diagnostics["tags"] = [PRE_POPUP_TAG]
        self.versions.append({
            **diagnostics,
            "id": "directpopup1",
            "description": DIRECT_POPUP_FINGERPRINT,
            "tags": [TAG],
            "environment": {
                **diagnostics["environment"],
                "MEZFIT_BROWSER_CHALLENGE_BUCKET": nonce_bucket_name(FOLDER),
            },
        })
        self.spec = browser_auth_gateway_spec(bucket_name(FOLDER), "function1", SA, popup=True)
        self.mirror_name = jwks_mirror.bucket_name(FOLDER)
        self.publisher = {"id": "publisher1", "name": jwks_mirror.NAME_SA, "folderId": FOLDER}
        self.mirror_bindings = [jwks_mirror.expected_binding(self.publisher["id"])]
        self.bindings_path = f"{STORAGE}/mirrorbucket1"
        self.checked_at = datetime.now(timezone.utc)

    def __call__(self, url, label, payload=None):
        if url.startswith(jwks_mirror.IAM_SA + "?"):
            return {"serviceAccounts": [self.publisher]}
        if url == f"{STORAGE}/{self.mirror_name}?view=VIEW_FULL":
            return {"name": self.mirror_name, "folderId": FOLDER, "resourceId": "mirrorbucket1",
                    "anonymousAccessFlags": jwks_mirror.PRIVATE}
        if url == self.bindings_path + ":listAccessBindings":
            return {"accessBindings": self.mirror_bindings}
        keys = b'{"keys":[{"kid":"oidc-1"}]}'
        base = f"https://storage.yandexcloud.net/{self.mirror_name}"
        if url == f"{base}/jwks.json":
            return keys
        if url == f"{base}/status.json":
            return json.dumps({
                "source": "https://oauth.telegram.org/.well-known/jwks.json",
                "checkedAt": self.checked_at.isoformat(),
                "jwksSha256": hashlib.sha256(keys).hexdigest(),
            }).encode()
        return super().__call__(url, label, payload)

    def update(self, url, label, payload, method):
        if url == self.bindings_path + ":updateAccessBindings":
            assert method == "PATCH"
            assert payload == {"accessBindingDeltas": [
                {"action": "ADD", "accessBinding": jwks_mirror.reader_binding(RUNTIME_SA)}
            ]}
            self.writes.append((url, payload))
            self.mirror_bindings.append(jwks_mirror.reader_binding(RUNTIME_SA))
            return self.operation({})
        return super().update(url, label, payload, method)


class BrowserJwksMirrorTests(unittest.TestCase):
    def test_preview_and_apply_from_existing_popup_then_rollback(self):
        cloud = MirrorCloud()
        original_spec = cloud.spec
        cloud.execute("preview", "popup-mirror", "")
        self.assertEqual(cloud.writes, [])
        cloud.execute("apply", "popup-mirror", POPUP_MIRROR)
        self.assertEqual([url for url, _ in cloud.writes], [
            cloud.bindings_path + ":updateAccessBindings", VERSIONS, VERSIONS + "/version2:setTag",
        ])
        self.assertEqual(cloud.versions[-1]["environment"]["MEZFIT_BROWSER_JWKS_BUCKET"], cloud.mirror_name)
        self.assertIn(TAG, cloud.versions[-1]["tags"])
        self.assertEqual(cloud.spec, original_spec)
        cloud.execute("apply", "popup-mirror", POPUP_MIRROR)
        self.assertEqual(len(cloud.writes), 3)
        cloud.execute("apply", "popup-rollback", POPUP_ROLLBACK)
        self.assertIn(TAG, cloud.versions[0]["tags"])
        self.assertEqual(set(cloud.spec["paths"]["/auth/callback"]), {"get"})

    def test_stale_heartbeat_rejects_before_any_write(self):
        cloud = MirrorCloud()
        cloud.checked_at -= timedelta(minutes=6)
        with self.assertRaisesRegex(WebHostingError, "freshness"):
            cloud.execute("apply", "popup-mirror", POPUP_MIRROR)
        self.assertEqual(cloud.writes, [])
