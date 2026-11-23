import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.error import HTTPError

from deploy_browser_auth import (
    NonceBucketSetupError, deploy_nonce_bucket_policy, main, nonce_bucket_name,
    report_nonce_bucket_diagnostics,
)
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA, SECRET, SECRET_VERSION
from web_hosting import STORAGE


class NonceBucketDiagnostics(unittest.TestCase):
    def test_reports_all_probes_after_a_denial_without_writing_or_logging_values(self):
        bucket = nonce_bucket_name(FOLDER)
        management = f"{STORAGE}/{bucket}"
        s3 = f"https://storage.yandexcloud.net/{bucket}"
        bucket_list = f"{STORAGE}?folderId={FOLDER}&pageSize=1000"
        requests = []

        class Response(io.BytesIO):
            status = 200

        def open_request(request, timeout):
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Authorization"), "Bearer sample-token")
            url = request.full_url
            requests.append(url)
            if url.endswith(("?view=VIEW_BASIC", "?view=VIEW_ACL", "?view=VIEW_FULL", "?lifecycle")):
                raise HTTPError(url, 403, "sample-private-error", {}, None)
            if url == bucket_list:
                metadata = {"name": bucket, "folderId": FOLDER, "resourceId": "private-resource-id"}
                return Response(json.dumps({"buckets": [metadata]}).encode())
            if url.endswith(":listAccessBindings"):
                return Response(b"{}")
            if url == s3 + "?policy":
                return Response(b'{"private-policy-key":"private-value"}')
            return Response(b"<private> XML response </private>")

        class Opener:
            open = staticmethod(open_request)

        output = io.StringIO()
        with redirect_stdout(output):
            report_nonce_bucket_diagnostics(
                Opener(), "sample-token", FOLDER, SA, RUNTIME_SA,
                deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA),
            )
        report = output.getvalue()
        self.assertEqual(requests, [
            management + "?view=VIEW_BASIC", management + "?view=VIEW_ACL",
            management + "?view=VIEW_FULL", bucket_list,
            f"{STORAGE}/private-resource-id:listAccessBindings", s3 + "?policy", s3 + "?lifecycle",
            *[f"{s3}?{query}" for query in ("acl", "cors", "website", "versioning", "location", "encryption")],
        ])
        self.assertIn("[management VIEW_BASIC]: HTTP 403", report)
        self.assertIn("[management VIEW_FULL]: HTTP 403", report)
        self.assertIn("[direct IAM bindings]: HTTP 200; no direct bindings: True", report)
        self.assertIn("[S3 policy]: HTTP 200; Version, unexpected top-level fields", report)
        self.assertIn("[S3 lifecycle]: HTTP 403", report)
        self.assertIn("[S3 encryption]: HTTP 200", report)
        for private_value in ("sample-token", "sample-private-error", "private-resource-id",
                              "private-policy-key", "private-value", "XML response", FOLDER):
            self.assertNotIn(private_value, report)

    def test_workflow_reports_diagnostics_and_still_fails_the_original_check(self):
        env = {"MODE": "preview", "ACTION": "popup", "CONFIRM": "", "YC_DEPLOY_SA_ID": SA,
               "YC_FOLDER_ID": FOLDER, "YC_IAM_TOKEN": "sample-token"}
        failure = NonceBucketSetupError("original verification error")
        with (
            patch.dict("os.environ", env, clear=True),
            patch("browser_auth_bootstrap.bootstrap", return_value=(RUNTIME_SA, SECRET, SECRET_VERSION)),
            patch("deploy_browser_auth.execute", side_effect=failure),
            patch("deploy_browser_auth.report_nonce_bucket_diagnostics") as report,
        ):
            with self.assertRaises(NonceBucketSetupError) as raised:
                main()
        self.assertIs(raised.exception, failure)
        self.assertEqual(report.call_args.args[1:5], ("sample-token", FOLDER, SA, RUNTIME_SA))
        self.assertEqual(report.call_args.args[5], deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA))
