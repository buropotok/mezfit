"""Browser login deploy contract for gateways with their public domains attached."""
from unittest import TestCase

import test_browser_auth_jwks_bucket
from test_deploy_browser_auth import DOMAIN, FOLDER
from web_hosting import CERTIFICATES, WebHostingError


class CustomDomainMirrorCloud(test_browser_auth_jwks_bucket.MirrorCloud):
    def __init__(self):
        super().__init__()
        self.gateway["attachedDomains"] = [
            {"domain": "mezfit.online", "certificateId": "certonline", "enabled": True},
        ]
        self.spec["servers"] = [
            {"url": f"https://{DOMAIN}"},
            {"url": "https://mezfit.online"},
        ]

    def __call__(self, url, label, payload=None):
        if url.startswith(CERTIFICATES + "?"):
            return {"certificates": [{
                "id": "certonline", "name": "mezfit-online-web", "folderId": FOLDER,
                "domains": ["mezfit.online"], "type": "MANAGED", "status": "ISSUED",
                "deletionProtection": True,
            }]}
        return super().__call__(url, label, payload)


class BrowserAuthCustomDomainTests(TestCase):
    def test_mirror_can_be_enabled_with_the_verified_custom_server(self):
        cloud = CustomDomainMirrorCloud()
        cloud.execute("preview", "popup-mirror")
        self.assertEqual(cloud.writes, [])
        cloud.execute("apply", "popup-mirror")
        self.assertEqual(cloud.spec["servers"][1], {"url": "https://mezfit.online"})
        self.assertFalse(any("/apigateways/" in url for url, _ in cloud.writes))

    def test_unattached_server_still_blocks_mirror_apply(self):
        cloud = CustomDomainMirrorCloud()
        cloud.spec["servers"].append({"url": "https://mezfit.ru"})
        with self.assertRaisesRegex(WebHostingError, "unexpected server URL"):
            cloud.execute("apply", "popup-mirror")
        self.assertEqual(cloud.writes, [])
