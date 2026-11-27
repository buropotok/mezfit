"""Full snapshots extend the existing private receiver and redact sensitive fields."""

import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).with_name("account-replica")))
import index as receiver
sys.path.pop(0)

SECRET = "x" * 43
KEY = str(2**53 - 1)
VERIFIER = "$argon2id$v=19$m=65536,t=3,p=1$" + "A" * 22 + "$" + "B" * 43
IDENTITY = {"userId": KEY, "telegramId": None, "login": "sample", "passHash": VERIFIER, "state": "active"}


def request(identity=IDENTITY):
    return {
        "headers": {"Authorization": "Bearer " + SECRET}, "httpMethod": "POST",
        "body": json.dumps({"user": None, "roles": [], "revision": 7, "identity": identity}),
    }


class FullSnapshotContracts(unittest.TestCase):
    def test_password_verifier_is_stored_separately_from_profile_json(self):
        with patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}), \
                patch.object(receiver, "runtime_store", return_value="store"), \
                patch.object(receiver, "save", return_value=("applied", 7)) as save:
            response = receiver.handler(request(), None)
        save.assert_called_once_with("store", KEY, 7, '{"roles":[],"user":null}',
                                     (None, "sample", VERIFIER, "active"))
        self.assertEqual(json.loads(response["body"]), {"status": "applied", "revision": 7})
        self.assertNotIn(VERIFIER, str(response))

    def test_rejects_forged_or_invalid_full_snapshots_and_redacts_failure(self):
        with patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}), \
                patch.object(receiver, "runtime_store", return_value="store") as store, \
                patch.object(receiver, "save", side_effect=TimeoutError(VERIFIER)), \
                patch("builtins.print") as log:
            unauthorized = request()
            unauthorized["headers"] = {}
            self.assertEqual(receiver.handler(unauthorized, None)["statusCode"], 401)
            for changes in ({"userId": "01"}, {"userId": str(2**53)}, {"userId": 42},
                            {"passHash": "plaintext"}, {"telegramId": "123"}, {"state": "deleted"}):
                self.assertEqual(receiver.handler(request(IDENTITY | changes), None)["statusCode"], 400)
            store.assert_not_called()
            self.assertEqual(receiver.handler(request(), None)["statusCode"], 503)
            for value in (KEY, SECRET, VERIFIER, "sample"):
                self.assertNotIn(value, str(log.call_args_list))
