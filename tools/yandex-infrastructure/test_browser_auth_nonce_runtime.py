from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from deploy_browser_auth import (
    RUNTIME_IAM_TOKEN_URL, YandexHttpError, ensure_mirror_nonce_access, nonce_bucket_name,
    nonce_runtime_binding, verify_nonce_runtime_write,
)
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA
from web_hosting import STORAGE, WebHostingError


class NonceRuntimeContracts(TestCase):
    def test_apply_uses_verified_folder_list_when_bucket_get_is_forbidden(self):
        bucket = nonce_bucket_name(FOLDER)
        bucket_id = "nonceresource1"
        binding = nonce_runtime_binding(RUNTIME_SA)
        bindings = []

        def api(url, label):
            if url == f"{STORAGE}/{bucket}?view=VIEW_BASIC":
                raise YandexHttpError(label, 403)
            if url.startswith(f"{STORAGE}?folderId={FOLDER}&"):
                return {"buckets": [{"name": bucket, "resourceId": bucket_id, "folderId": FOLDER}]}
            if url == f"{STORAGE}/{bucket_id}:listAccessBindings":
                return {"accessBindings": bindings.copy()}
            self.fail(f"Unexpected API request: {url}")

        def grant(url, label, payload, method):
            self.assertEqual(url, f"{STORAGE}/{bucket_id}:updateAccessBindings")
            self.assertEqual(method, "PATCH")
            self.assertEqual(payload, {"accessBindingDeltas": [{"action": "ADD", "accessBinding": binding}]})
            bindings.append(binding)
            return {"id": "operation1", "done": True, "response": {}}

        probe = Mock()
        with patch("deploy_browser_auth.ensure_nonce_bucket", return_value=bucket):
            ensure_mirror_nonce_access("apply", FOLDER, SA, RUNTIME_SA, api, grant, Mock(), {}, probe)
        self.assertEqual(bindings, [binding])
        probe.assert_called_once_with(bucket)

    def test_apply_grants_only_the_runtime_write_role_at_bucket_scope(self):
        bucket = nonce_bucket_name(FOLDER)
        bucket_id = "nonceresource1"
        binding = nonce_runtime_binding(RUNTIME_SA)
        bindings = []
        api = Mock(side_effect=lambda url, _: (
            {"name": bucket, "resourceId": bucket_id, "folderId": FOLDER}
            if url.endswith("?view=VIEW_BASIC") else {"accessBindings": bindings.copy()}
        ))
        probe = Mock()

        def grant(url, label, payload, method):
            self.assertEqual(url, f"{STORAGE}/{bucket_id}:updateAccessBindings")
            self.assertEqual(method, "PATCH")
            self.assertEqual(payload, {"accessBindingDeltas": [
                {"action": "ADD", "accessBinding": binding},
            ]})
            bindings.append(binding)
            return {"id": "operation1", "done": True, "response": {}}

        update = Mock(side_effect=grant)
        with patch("deploy_browser_auth.ensure_nonce_bucket", return_value=bucket):
            ensure_mirror_nonce_access("preview", FOLDER, SA, RUNTIME_SA, api, update,
                                       Mock(), {}, probe)
            update.assert_not_called()
            probe.assert_not_called()
            for _ in range(2):
                ensure_mirror_nonce_access("apply", FOLDER, SA, RUNTIME_SA, api, update,
                                           Mock(), {}, probe)
        self.assertEqual(update.call_count, 1)
        self.assertEqual(probe.call_count, 2)
        probe.assert_called_with(bucket)

    def test_live_probe_uses_runtime_identity_and_checks_conditional_storage(self):
        bucket = nonce_bucket_name(FOLDER)
        for unconditional, succeeds in [(403, True), (200, False)]:
            with self.subTest(unconditional=unconditional):
                opener = Mock()
                sleep = Mock()
                ok = Mock()
                ok.__enter__ = Mock(return_value=Mock(status=200))
                ok.__exit__ = Mock(return_value=False)
                opener.open.side_effect = [
                    HTTPError("", 403, "", None, None),
                    ok,
                    HTTPError("", 412, "", None, None),
                    HTTPError("", 403, "", None, None) if succeeds else ok,
                ]
                with patch("deploy_browser_auth.request_api", return_value={"iamToken": "runtime-token"}) as mint:
                    if succeeds:
                        verify_nonce_runtime_write(opener, "deployment-token", RUNTIME_SA, bucket, sleep)
                    else:
                        with self.assertRaisesRegex(WebHostingError, "did not enforce"):
                            verify_nonce_runtime_write(opener, "deployment-token", RUNTIME_SA, bucket, sleep)
                self.assertEqual(mint.call_args.args[2], RUNTIME_IAM_TOKEN_URL)
                self.assertEqual(mint.call_args.args[4], {"serviceAccountId": RUNTIME_SA})
                sleep.assert_called_once_with(5)
                requests = [call.args[0] for call in opener.open.call_args_list]
                self.assertEqual(len({req.full_url for req in requests}), 1)
                self.assertTrue(requests[0].full_url.startswith(f"https://storage.yandexcloud.net/{bucket}/used/"))
                self.assertTrue(all(req.get_header("Authorization") == "Bearer runtime-token" for req in requests))
                self.assertEqual([req.get_header("If-none-match") for req in requests], ["*", "*", "*", None])
