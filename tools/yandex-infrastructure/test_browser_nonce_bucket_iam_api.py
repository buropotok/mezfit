"""Verify the transport resolves Storage IAM identity before listing grants."""

from io import BytesIO
import json
import unittest

from deploy_browser_auth import nonce_bucket_name, request_api
from web_hosting import STORAGE, WebHostingError


BUCKET = nonce_bucket_name("test-folder")
RESOURCE_ID = "e3e-iam-resource-id"
BINDINGS_BY_NAME = f"{STORAGE}/{BUCKET}:listAccessBindings"
BUCKET_METADATA = f"{STORAGE}/{BUCKET}?view=VIEW_BASIC"
BINDINGS_BY_ID = f"{STORAGE}/{RESOURCE_ID}:listAccessBindings"


class StubOpener:
    def __init__(self, responses):
        self.responses = responses
        self.urls = []

    def open(self, request, timeout):
        self.urls.append(request.full_url)
        assert request.get_method() == "GET"
        return BytesIO(json.dumps(self.responses[request.full_url]).encode("utf-8"))


class BrowserNonceBucketIamTransportContract(unittest.TestCase):
    def test_uses_resource_id_and_returns_actual_bindings(self):
        bindings = [{"roleId": "storage.viewer", "subject": {"type": "system", "id": "allUsers"}}]
        opener = StubOpener({
            BUCKET_METADATA: {"id": BUCKET, "name": BUCKET, "resourceId": RESOURCE_ID},
            BINDINGS_BY_ID: {"accessBindings": bindings},
        })
        result = request_api(opener, "test-token", BINDINGS_BY_NAME, "Read nonce bucket IAM bindings")
        self.assertEqual(result["accessBindings"], bindings)
        self.assertEqual(opener.urls, [BUCKET_METADATA, BINDINGS_BY_ID])

    def test_missing_or_malformed_id_never_falls_back_to_bucket_name(self):
        for metadata in ({"name": BUCKET, "id": BUCKET},
                         {"name": BUCKET, "resourceId": "invalid/resource"},
                         {"name": "other", "resourceId": RESOURCE_ID}):
            with self.subTest(metadata=metadata):
                opener = StubOpener({BUCKET_METADATA: metadata})
                with self.assertRaisesRegex(WebHostingError, "resource ID missing or invalid"):
                    request_api(opener, "test-token", BINDINGS_BY_NAME, "Read nonce bucket IAM bindings")
                self.assertEqual(opener.urls, [BUCKET_METADATA])
