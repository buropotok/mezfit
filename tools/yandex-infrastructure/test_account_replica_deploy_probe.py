"""Route checks use the live sender hostname and require the receiver's 401."""

from io import BytesIO
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from deploy_account_replica import verify_unsigned_post
from web_hosting import ACCOUNT_REPLICA_PATH, WebHostingError

GATEWAY = {"domain": "gateway.apigw.yandexcloud.net"}


class AccountReplicaProbeTests(unittest.TestCase):
    def test_probes_the_verified_custom_domain_or_the_bootstrap_domain(self):
        for attachments, host in (({"mezfit.online"}, "mezfit.online"), (set(), GATEWAY["domain"])):
            with self.subTest(host=host), patch("deploy_account_replica.verified_gateway_domains",
                                               return_value=attachments):
                url = f"https://{host}{ACCOUNT_REPLICA_PATH}"
                opener = Mock()
                opener.open.side_effect = HTTPError(
                    url, 401, "Unauthorized", {}, BytesIO(b'{"error":{"code":"UNAUTHORIZED"}}'),
                )
                verify_unsigned_post(opener, GATEWAY, "folder", Mock())
                request = opener.open.call_args.args[0]
                self.assertEqual((request.full_url, request.get_method()), (url, "POST"))
                self.assertFalse(request.has_header("Authorization"))

    def test_reports_transport_failure_without_accepting_it_as_success(self):
        with patch("deploy_account_replica.verified_gateway_domains", return_value={"mezfit.online"}):
            opener = Mock()
            opener.open.side_effect = URLError(TimeoutError("details"))
            with self.assertRaisesRegex(WebHostingError, r"mezfit\.online failed: TimeoutError"):
                verify_unsigned_post(opener, GATEWAY, "folder", Mock())
            opener.open.side_effect = HTTPError(
                "https://mezfit.online", 401, "Unauthorized", {}, BytesIO(b'{}'),
            )
            with self.assertRaisesRegex(WebHostingError, "Unexpected receiver response"):
                verify_unsigned_post(opener, GATEWAY, "folder", Mock())
