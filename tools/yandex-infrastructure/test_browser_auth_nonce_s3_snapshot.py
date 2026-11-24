import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from deploy_browser_auth import (
    NonceBucketSetupError, canonical_nonce_policy, deploy_nonce_bucket_policy, ensure_nonce_bucket,
    main, nonce_bucket_contract,
)
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA, SECRET, SECRET_VERSION
from web_hosting import STORAGE, WebHostingError


class NonceBucketS3Readback(unittest.TestCase):
    def setUp(self):
        self.settings, _ = nonce_bucket_contract(FOLDER, RUNTIME_SA)
        self.policy = deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA)
        self.observed = json.loads(json.dumps(self.policy))
        runtime, deploy = self.observed["Statement"]
        for rule in (runtime, deploy):
            rule["Resource"] = rule["Resource"][0]
            rule["Principal"]["CanonicalUser"] = rule["Principal"]["CanonicalUser"][0]
        runtime["Action"] = runtime["Action"][0]

    def test_policy_normalizes_only_equivalent_rules(self):
        self.observed["Statement"].reverse()
        self.assertEqual(canonical_nonce_policy(self.observed, self.policy), self.policy)
        self.observed["Statement"][1]["Condition"]["Null"].clear()
        self.assertNotEqual(canonical_nonce_policy(self.observed, self.policy), self.policy)

    def test_preview_uses_s3_and_rejects_configuration_drift(self):
        bucket = self.settings["name"]
        bucket_list = f"{STORAGE}?folderId={FOLDER}&pageSize=1000"
        s3 = f"https://storage.yandexcloud.net/{bucket}"
        for drift, error in (("", ""), ("tags", "tags"), ("acl", "ACL grant"),
                             ("cors", "S3 cors"), ("anonymous", "anonymousAccessFlags"),
                             ("iam", "IAM bindings")):
            with self.subTest(drift=drift):
                calls = []

                def open_request(request, timeout):
                    self.assertEqual(request.get_method(), "GET")
                    url = request.full_url
                    calls.append(url)
                    if url == bucket_list:
                        metadata = {**self.settings, "resourceId": "test-bucket-resource-id"}
                        if drift == "anonymous":
                            metadata["anonymousAccessFlags"] = {"read": True}
                        return io.BytesIO(json.dumps({"buckets": [metadata]}).encode())
                    if url == f"{STORAGE}/{bucket}?view=VIEW_FULL":
                        raise HTTPError(url, 403, "Forbidden", {}, None)
                    if url == f"{STORAGE}/test-bucket-resource-id:listAccessBindings":
                        return io.BytesIO(b'{"accessBindings":[{}]}' if drift == "iam" else b"{}")
                    if url == s3 + "?policy":
                        return io.BytesIO(json.dumps(self.observed).encode())
                    if url == s3 + "?tagging":
                        value = "wrong" if drift == "tags" else "browser-login-nonce"
                        return io.BytesIO(("<Tagging><TagSet><Tag><Key>mezfit-purpose</Key>"
                                           f"<Value>{value}</Value></Tag></TagSet></Tagging>").encode())
                    if url == s3 + "?acl":
                        grantee = "other-account" if drift == "acl" else FOLDER
                        return io.BytesIO((
                            f"<AccessControlPolicy><Owner><ID>{FOLDER}</ID></Owner><AccessControlList>"
                            '<Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
                            f' xsi:type="CanonicalUser"><ID>{grantee}</ID></Grantee>'
                            "<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>"
                        ).encode())
                    if url in (s3 + "?cors", s3 + "?website"):
                        code = "NoSuchCORSConfiguration" if url.endswith("?cors") else "NoSuchWebsiteConfiguration"
                        if url.endswith("?cors") and drift == "cors":
                            code = "NoSuchBucket"
                        raise HTTPError(url, 404, "Not found", {}, io.BytesIO(f"<Error><Code>{code}</Code></Error>".encode()))
                    if url == s3 + "?lifecycle":
                        return io.BytesIO(b"<LifecycleConfiguration><Rule><ID>expire-used-nonces</ID>"
                                          b"<Status>Enabled</Status><Filter><Prefix>used/</Prefix></Filter>"
                                          b"<Expiration><Days>1</Days></Expiration></Rule></LifecycleConfiguration>")
                    self.fail(f"Unexpected request: {url}")

                class Opener:
                    open = staticmethod(open_request)

                def execute(mode, action, folder, deploy_sa, runtime_sa, secret, version, api, update_api,
                            *, nonce_policy):
                    try:
                        ensure_nonce_bucket(mode, folder, deploy_sa, runtime_sa, api, update_api,
                                           lambda _: None, nonce_policy=nonce_policy)
                    except WebHostingError as failure:
                        raise NonceBucketSetupError(str(failure)) from None

                env = {"MODE": "preview", "ACTION": "popup", "YC_DEPLOY_SA_ID": SA,
                       "YC_FOLDER_ID": FOLDER, "YC_IAM_TOKEN": "sample-token"}
                with (
                    patch.dict("os.environ", env, clear=True),
                    patch("browser_auth_bootstrap.bootstrap", return_value=(RUNTIME_SA, SECRET, SECRET_VERSION)),
                    patch("deploy_browser_auth.build_opener", return_value=Opener()),
                    patch("deploy_browser_auth.execute", side_effect=execute),
                    patch("deploy_browser_auth.report_nonce_bucket_diagnostics"),
                ):
                    if error:
                        with self.assertRaisesRegex(NonceBucketSetupError, error):
                            main()
                    else:
                        main()
                        self.assertIn(f"{STORAGE}/test-bucket-resource-id:listAccessBindings", calls)
