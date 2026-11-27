"""Receiver contracts through the private function boundary."""

import base64
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).with_name("credential-replica")))
import credential_receiver as receiver
sys.path.pop(0)

SECRET = "x" * 43
TELEGRAM_ONLY = {
    "user_id": "123456", "app_user_id": "42", "telegram_id": "123456",
    "login": None, "pass_hash": None, "revision": 1, "state": "active",
}
# Encoded shape fixture only. These fields contain no password or real verifier.
VERIFIER = "$argon2id$v=19$m=65536,t=3,p=1$" + "A" * 22 + "$" + "B" * 43


def request(payload=TELEGRAM_ONLY, **options):
    return {"httpMethod": "POST", "headers": {"Authorization": f"Bearer {SECRET}"},
            "body": json.dumps(payload), **options}


class CredentialReceiverContracts(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}))
        self.store = self.enterContext(patch.object(receiver, "runtime_store"))
        self.save = self.enterContext(patch.object(receiver, "save", return_value=("applied", 1)))
        self.log = self.enterContext(patch("builtins.print"))

    def test_telegram_only_password_only_and_linked_ids_keep_their_exact_values(self):
        for payload in (
            TELEGRAM_ONLY,
            TELEGRAM_ONLY | {"user_id": str(2**52), "app_user_id": None, "telegram_id": None,
                             "login": "example", "pass_hash": VERIFIER},
            TELEGRAM_ONLY | {"user_id": str(2**53 - 1), "login": "example", "pass_hash": VERIFIER},
        ):
            event = request(payload)
            event["body"] = base64.b64encode(event["body"].encode()).decode()
            event["isBase64Encoded"] = True
            result = receiver.handler(event, None)
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(json.loads(result["body"]), {"status": "applied", "revision": 1})
            self.assertEqual(result["headers"]["Cache-Control"], "no-store")
            snapshot = self.save.call_args.args[1]
            self.assertEqual(snapshot.user_id, int(payload["user_id"]))
            self.assertEqual(snapshot.telegram_id, int(payload["telegram_id"]) if payload["telegram_id"] else None)
            self.assertEqual(snapshot.pass_hash, payload["pass_hash"])
        self.log.assert_not_called()

    def test_requires_independent_secret_and_refuses_public_or_ambiguous_authorization(self):
        for headers in ({}, {"Authorization": "Bearer " + "y" * 43}, {
            "Authorization": "Bearer " + SECRET, "authorization": "Bearer " + SECRET,
        }):
            self.assertEqual(receiver.handler(request(headers=headers), None)["statusCode"], 401)
        self.store.assert_not_called()
        self.save.assert_not_called()

    def test_rejects_invalid_payload_before_opening_ydb(self):
        invalid = [
            request(body='{"user_id":"1","user_id":"2"}'),
            request(body=" " * 2049),
            request(body="!!!", isBase64Encoded=True),
        ]
        invalid += [request(TELEGRAM_ONLY | change) for change in (
            {"user_id": "0123456"}, {"user_id": "1e5"}, {"user_id": 123456},
            {"user_id": str(2**53)}, {"telegram_id": str(2**52)}, {"app_user_id": None},
            {"telegram_id": "654321"}, {"revision": True}, {"revision": 1.0}, {"state": "deleted"},
            {"login": ["a"]}, {"login": "Not_Normalized"}, {"pass_hash": "plaintext"},
            {"pass_hash": VERIFIER}, {"roles": ["coach"]},
        )]
        for event in invalid:
            with self.subTest(event=event):
                self.assertEqual(receiver.handler(event, None)["statusCode"], 400)
        self.store.assert_not_called()

    def test_idempotency_errors_and_timeout_are_redacted(self):
        payload = TELEGRAM_ONLY | {"login": "example", "pass_hash": VERIFIER}
        self.save.side_effect = [
            ("duplicate", 1), ("stale", 3), ("revision_conflict", 1), ("lookup_conflict", None),
            ("deleted", 4), TimeoutError(VERIFIER),
        ]
        for status, body in (
            (200, {"status": "duplicate", "revision": 1}), (200, {"status": "stale", "revision": 3}),
            (409, {"error": {"code": "REVISION_CONFLICT"}, "revision": 1}),
            (409, {"error": {"code": "LOOKUP_CONFLICT"}}),
            (409, {"error": {"code": "ID_DELETED"}, "revision": 4}),
            (503, {"error": {"code": "REPLICA_UNAVAILABLE"}}),
        ):
            response = receiver.handler(request(payload), None)
            self.assertEqual(response["statusCode"], status)
            self.assertEqual(json.loads(response["body"]), body)
        for private in (VERIFIER, SECRET, "example", TELEGRAM_ONLY["telegram_id"]):
            self.assertNotIn(private, str(self.log.call_args_list))
