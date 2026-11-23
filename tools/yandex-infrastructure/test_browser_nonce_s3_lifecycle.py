"""Verify the effective S3 lifecycle when the management JSON differs."""

from copy import deepcopy
import unittest

from deploy_browser_auth import POPUP, approved_nonce_lifecycle_xml
from test_browser_auth_popup import PopupCloud
from web_hosting import WebHostingError


XML = b"""<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Rule>
        <ID>expire-used-nonces</ID>
        <Status>Enabled</Status>
        <Filter><Prefix>used/</Prefix></Filter>
        <Expiration><Days>1</Days></Expiration>
    </Rule>
</LifecycleConfiguration>"""


class S3LifecycleCloud(PopupCloud):
    def __init__(self, xml):
        super().__init__()
        self.nonce_bucket = deepcopy(self.settings)
        self.nonce_bucket["lifecycleRules"][0]["filter"]["objectSizeGreaterThan"] = "0"
        self.xml = xml
        self.s3_reads = 0

    def __call__(self, url, label, payload=None):
        if url == f"https://storage.yandexcloud.net/{self.settings['name']}?lifecycle":
            assert payload is None
            self.s3_reads += 1
            return {"approved": approved_nonce_lifecycle_xml(self.xml)}
        return super().__call__(url, label, payload)


class BrowserNonceS3LifecycleContract(unittest.TestCase):
    def test_format_difference_requires_exact_s3_validation_before_write(self):
        cloud = S3LifecycleCloud(XML)
        cloud.execute("preview", "popup", "")
        self.assertEqual(cloud.s3_reads, 1)
        self.assertEqual(cloud.writes, [])
        cloud.execute("apply", "popup", POPUP)
        self.assertEqual(cloud.nonce_bucket["policy"], cloud.policy)
        self.assertGreater(cloud.s3_reads, 1)

    def test_real_retention_drift_is_rejected_without_mutation(self):
        cloud = S3LifecycleCloud(XML.replace(b"<Days>1</Days>", b"<Days>2</Days>"))
        with self.assertRaisesRegex(WebHostingError, "lifecycleRules"):
            cloud.execute("apply", "popup", POPUP)
        self.assertEqual(cloud.s3_reads, 1)
        self.assertEqual(cloud.writes, [])

    def test_parser_rejects_changed_prefix_filters_and_xml_entities(self):
        self.assertTrue(approved_nonce_lifecycle_xml(XML))
        self.assertTrue(approved_nonce_lifecycle_xml(XML.replace(b"<Filter>", b"").replace(b"</Filter>", b"")))
        for payload in (
            XML.replace(b"used/", b" used/ "),
            XML.replace(b"</Filter>", b"<ObjectSizeGreaterThan>0</ObjectSizeGreaterThan></Filter>"),
            XML.replace(b"</LifecycleConfiguration>", b"<Rule/></LifecycleConfiguration>"),
            b'<!DOCTYPE LifecycleConfiguration [<!ENTITY rule "used/">]>' + XML,
        ):
            with self.subTest(payload=payload):
                self.assertFalse(approved_nonce_lifecycle_xml(payload))
