import unittest
from xml.etree import ElementTree

from deploy_browser_auth import deploy_nonce_bucket_policy, nonce_bucket_name, nonce_s3_bucket_snapshot, verify_nonce_s3_acl
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA
from web_hosting import STORAGE, WebHostingError


class NonceBucketAclReadback(unittest.TestCase):
    def test_empty_acl_can_omit_owner_metadata(self):
        for body in (
            "",
            "<AccessControlList/>",
            "<Owner/><AccessControlList/>",
            "<Owner><ID/></Owner><AccessControlList/>",
            f"<Owner><ID>{FOLDER}</ID></Owner>",
            f"<Owner><ID>{SA}</ID></Owner><AccessControlList/>",
        ):
            with self.subTest(body=body):
                acl = ElementTree.fromstring(f"<AccessControlPolicy>{body}</AccessControlPolicy>")
                verify_nonce_s3_acl(acl, FOLDER, SA)

    def test_rejects_unknown_owner_public_grant_and_unrecognized_elements(self):
        for body in (
            "<Owner><ID>another-owner</ID></Owner><AccessControlList/>",
            "<UnexpectedList/>",
            "<AccessControlList/><AccessControlList/>",
            '<AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
            ' xsi:type="Group"><URI>http://acs.amazonaws.com/groups/global/AllUsers</URI></Grantee>'
            "<Permission>READ</Permission></Grant></AccessControlList>",
        ):
            with self.subTest(body=body):
                acl = ElementTree.fromstring(f"<AccessControlPolicy>{body}</AccessControlPolicy>")
                with self.assertRaises(WebHostingError):
                    verify_nonce_s3_acl(acl, FOLDER, SA)

    def test_acl_failure_does_not_hide_other_s3_failures(self):
        bucket = nonce_bucket_name(FOLDER)
        policy = deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA)
        checks = []

        def request(url, label, **options):
            if url.startswith(f"{STORAGE}?"):
                return {"buckets": [{"name": bucket, "folderId": FOLDER, "resourceId": "nonce-resource"}]}
            query = url.split("?")[-1]
            checks.append(query)
            return {
                "tagging": ElementTree.fromstring("<Tagging/>"),
                "acl": ElementTree.fromstring("<UnexpectedPolicy/>"),
                "cors": ElementTree.fromstring("<CORSConfiguration/>"),
                "website": None,
                "lifecycle": {"approved": False},
            }[query]

        with self.assertRaises(WebHostingError) as raised:
            nonce_s3_bucket_snapshot(request, FOLDER, SA, RUNTIME_SA, policy, policy)
        for message in ("Unexpected nonce bucket tags", "ACL document root",
                        "Unexpected nonce bucket cors", "lifecycleRules differ"):
            self.assertIn(message, str(raised.exception))
        self.assertEqual(checks, ["tagging", "acl", "cors", "website", "lifecycle"])
