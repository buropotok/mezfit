"""Readback contract tests for existing Yandex gateway (no live cloud requests).

This complements existing test_web_hosting.py without changing its assertions.
The operator must reuse an existing gateway only when route integrations, auth,
bucket ownership and unmigrated API 503 behavior are unchanged.
"""

from copy import deepcopy
import json
import unittest

from web_hosting import (
    CERTIFICATES, GATEWAYS, STORAGE, NAME_CERTIFICATE,
    NAME_GATEWAY, SAFE_FLAGS, WebHostingError, bucket_name, execute,
    gateway_spec, normalize_gateway_readback, verify_gateway,
)

FOLDER = "b1ggoodfolderid"
DOMAIN = "d5dgateway.apigw.yandexcloud.net"
GATEWAY = {
    "id": "gate1", "name": NAME_GATEWAY, "folderId": FOLDER,
    "domain": DOMAIN, "status": "ACTIVE", "attachedDomains": [],
}


def returned_spec():
    """A semantically identical spec with provider-generated OpenAPI defaults."""
    result = deepcopy(gateway_spec(bucket_name(FOLDER)))
    result["servers"] = [{"url": f"https://{DOMAIN}/", "description": "Default gateway"}]
    for path in result["paths"].values():
        for operation in path.values():
            operation["operationId"] = "yandex-generated"
            operation["responses"] = {"200": {"description": "Response"}}
            for param in operation.get("parameters", []):
                param["style"] = "simple"
                param["explode"] = False
                param["schema"]["style"] = "simple"
    integration = result["paths"]["/api"]["get"]["x-yc-apigateway-integration"]
    integration["http_headers"] = {
        "content-type": "application/json", "cache-control": "no-store",
    }
    return result


class FakeRecoveryApi:
    """Previously created bucket and gateway; certificate creation pending."""
    def __init__(self, spec):
        self.spec = spec
        self.calls = []
        self.certificates = []

    def __call__(self, url, label, payload=None):
        if payload is not None:
            self.calls.append((url, payload))
            if url == CERTIFICATES + "/requestNew":
                self.certificates = [{
                    "id": "cert1", "folderId": FOLDER, "name": NAME_CERTIFICATE,
                    "domains": ["mezfit.ru"], "type": "MANAGED",
                    "deletionProtection": True,
                }]
                return {"id": "operationcert1", "done": True, "response": {"id": "cert1"}}
            raise AssertionError(f"Unexpected mutation: {url}")
        if url.startswith(STORAGE + "?"):
            return {"buckets": [{
                "folderId": FOLDER, "name": bucket_name(FOLDER),
                "anonymousAccessFlags": SAFE_FLAGS,
            }]}
        if url.startswith(GATEWAYS + "?"):
            return {"apiGateways": [deepcopy(GATEWAY)]}
        if url == GATEWAYS + "/gate1:spec":
            return {"openapiSpec": json.dumps(self.spec)}
        if url.startswith(CERTIFICATES + "?"):
            return {"certificates": list(self.certificates)}
        if url == CERTIFICATES + "/cert1?view=FULL":
            return {"status": "VALIDATING", "challenges": []}
        raise AssertionError(f"Unexpected request: {url}")


class GatewayReadbackContracts(unittest.TestCase):
    def test_existing_unmodified_spec_is_reusable(self):
        api = FakeRecoveryApi(gateway_spec(bucket_name(FOLDER)))
        self.assertEqual(verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), api), GATEWAY)

    def test_normalized_spec_is_equivalent_without_mutating_response(self):
        actual = returned_spec()
        original = deepcopy(actual)
        self.assertEqual(
            normalize_gateway_readback(actual, DOMAIN),
            normalize_gateway_readback(gateway_spec(bucket_name(FOLDER)), DOMAIN),
        )
        self.assertEqual(actual, original)
        self.assertEqual(
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual)),
            GATEWAY,
        )

    def test_apply_reuses_existing_resources_and_requests_only_missing_tls(self):
        api = FakeRecoveryApi(returned_spec())
        execute("apply", FOLDER, api, sleep=lambda _: None)
        self.assertEqual([url for url, _ in api.calls],
                         [CERTIFICATES + "/requestNew"])
        self.assertEqual(api.calls[0][1]["domains"], ["mezfit.ru"])

    def test_preview_remains_read_only_with_existing_gateway(self):
        api = FakeRecoveryApi(returned_spec())
        execute("preview", FOLDER, api)
        self.assertEqual(api.calls, [])

    def test_drift_in_api_dummy_response_is_blocked_and_reported(self):
        actual = returned_spec()
        actual["paths"]["/api"]["get"]["x-yc-apigateway-integration"]["http_code"] = 200
        api = FakeRecoveryApi(actual)
        with self.assertRaisesRegex(WebHostingError, "http_code"):
            execute("apply", FOLDER, api, sleep=lambda _: None)
        self.assertEqual(api.calls, [])

    def test_drift_in_static_bucket_is_blocked(self):
        actual = returned_spec()
        actual["paths"]["/"]["get"]["x-yc-apigateway-integration"]["bucket"] = "other"
        with self.assertRaisesRegex(WebHostingError, "bucket"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_added_route_or_auth_policy_is_blocked(self):
        for mutate in (
            lambda spec: spec["paths"].update({"/admin": {"get": {}}}),
            lambda spec: spec.update({"security": [{"bearer": []}]}),
            lambda spec: spec["paths"]["/"]["get"].update({"security": []}),
        ):
            with self.subTest(mutate=mutate):
                actual = returned_spec()
                mutate(actual)
                with self.assertRaisesRegex(WebHostingError, "specification differs at"):
                    verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_arbitrary_server_host_is_not_treated_as_provider_default(self):
        actual = returned_spec()
        actual["servers"] = [{"url": "https://evil.example"}]
        with self.assertRaisesRegex(WebHostingError, "unexpected server URL"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_verified_attached_domain_is_allowed_as_provider_server(self):
        gateway = deepcopy(GATEWAY)
        gateway["attachedDomains"] = [{
            "domain": "mezfit.online", "certificateId": "cert-online", "enabled": True,
        }]
        actual = returned_spec()
        actual["servers"].append({"url": "https://mezfit.online"})
        api = FakeRecoveryApi(actual)
        api.certificates = [{
            "id": "cert-online", "name": "mezfit-online-web", "folderId": FOLDER,
            "domains": ["mezfit.online"], "type": "MANAGED",
            "deletionProtection": True, "status": "ISSUED",
        }]
        self.assertEqual(
            verify_gateway(gateway, FOLDER, bucket_name(FOLDER), api), gateway,
        )

        # An approved attachment must not authorize unrelated servers.
        actual["servers"].append({"url": "https://unexpected.example"})
        with self.assertRaisesRegex(WebHostingError, "unexpected server URL"):
            verify_gateway(gateway, FOLDER, bucket_name(FOLDER), api)

    def test_custom_server_requires_a_validated_gateway_attachment(self):
        actual = returned_spec()
        actual["servers"].append({"url": "https://mezfit.online"})
        with self.assertRaisesRegex(WebHostingError, "unexpected server URL"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

        gateway = deepcopy(GATEWAY)
        gateway["attachedDomains"] = [{
            "domain": "mezfit.online", "certificateId": "unapproved", "enabled": True,
        }]
        with self.assertRaisesRegex(WebHostingError, "Unexpected gateway domain"):
            verify_gateway(gateway, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_malformed_server_url_is_a_controlled_failure(self):
        actual = returned_spec()
        actual["servers"] = [{"url": 123}]
        with self.assertRaisesRegex(WebHostingError, "unexpected server URL"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_duplicate_headers_are_never_silently_merged(self):
        actual = returned_spec()
        actual["paths"]["/api"]["get"]["x-yc-apigateway-integration"]["http_headers"] = {
            "Content-Type": "application/json", "content-type": "text/html",
        }
        with self.assertRaisesRegex(WebHostingError, "duplicate HTTP header names"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))

    def test_unrecognized_path_parameter_default_is_rejected(self):
        actual = returned_spec()
        actual["paths"]["/{file+}"]["get"]["parameters"][0]["explode"] = True
        with self.assertRaisesRegex(WebHostingError, "explode"):
            verify_gateway(GATEWAY, FOLDER, bucket_name(FOLDER), FakeRecoveryApi(actual))


if __name__ == "__main__":
    unittest.main()
