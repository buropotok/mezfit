import io
import json
import unittest
from urllib.error import HTTPError

from deploy_browser_auth import deploy_nonce_bucket_policy, ensure_nonce_bucket, request_api
from test_browser_auth_popup import PopupCloud
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA
from web_hosting import STORAGE, WebHostingError


class NoncePolicyProbe(unittest.TestCase):
    def test_full_view_403_probes_s3_without_allowing_rollout(self):
        cloud = PopupCloud()
        cloud.nonce_bucket = cloud.settings.copy()
        expected_policy = deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA)
        bucket = cloud.settings["name"]
        full_view = f"{STORAGE}/{bucket}?view=VIEW_FULL"
        policy_url = f"https://storage.yandexcloud.net/{bucket}?policy"
        for response, message in (
            (expected_policy, "HTTP 200, policy matches the expected rules"),
            (cloud.policy, "HTTP 200, only the previous runtime rule is present"),
            ({"unexpected": "policy-body-is-private"}, "HTTP 200, policy differs from the expected rules"),
            (403, "HTTP 403"),
        ):
            with self.subTest(message=message):
                requests = []

                def open_request(request, timeout):
                    self.assertEqual(timeout, 30)
                    self.assertEqual(request.get_method(), "GET")
                    self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
                    requests.append(request.full_url)
                    if request.full_url == full_view or response == 403:
                        raise HTTPError(request.full_url, 403, "Forbidden", {}, None)
                    self.assertEqual(request.full_url, policy_url)
                    return io.BytesIO(json.dumps(response).encode())

                class Opener:
                    open = staticmethod(open_request)

                def api(url, label, payload=None):
                    if url == full_view:
                        return request_api(Opener(), "test-token", url, label, payload)
                    return cloud(url, label, payload)

                with self.assertRaisesRegex(WebHostingError, "S3 GetBucketPolicy: " + message) as failure:
                    ensure_nonce_bucket(
                        "apply", FOLDER, SA, RUNTIME_SA, api, cloud.update,
                        lambda _: None, nonce_policy=expected_policy,
                    )
                self.assertNotIn("policy-body-is-private", str(failure.exception))
                self.assertNotIn("test-token", str(failure.exception))
                self.assertEqual(requests, [full_view, policy_url])
                self.assertEqual(cloud.writes, [])
