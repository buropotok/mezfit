"""HTTP boundary contracts for the replica; no live cloud resources."""

import base64
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).with_name("account-replica")))
import index as receiver
sys.path.pop(0)

SECRET = "x" * 43
USER = {
    "id": 42, "telegramUserId": "123456789", "username": None, "firstName": "Example",
    "lastName": None, "languageCode": None, "photoUrl": None, "isPremium": False,
}


def request(*, snapshot=None, body=None):
    if body is None:
        body = json.dumps(snapshot if snapshot is not None else {"revision": 1, "user": USER, "roles": []})
    return {"httpMethod": "POST", "headers": {"Authorization": "Bearer " + SECRET}, "body": body}


class ReceiverContracts(unittest.TestCase):
    def test_preserves_full_snapshot_and_distinct_ids(self):
        for roles in ([], ["coach"], ["coach", "client"], ["client", "client"]):
            with self.subTest(roles=roles), patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}), \
                    patch.object(receiver, "runtime_store", return_value="store"), \
                    patch.object(receiver, "save", return_value=("applied", 12)) as save:
                event = request(snapshot={"revision": 12, "user": USER, "roles": roles})
                event["body"] = base64.b64encode(event["body"].encode()).decode()
                event["isBase64Encoded"] = True
                response = receiver.handler(event, None)
                self.assertEqual(response["statusCode"], 200)
                self.assertEqual(response["headers"]["Cache-Control"], "no-store")
                self.assertEqual(json.loads(response["body"]), {"status": "applied", "revision": 12})
                store, key, revision, snapshot = save.call_args.args
                self.assertEqual((store, key, revision), ("store", USER["telegramUserId"], 12))
                self.assertEqual(json.loads(snapshot), {"user": USER, "roles": sorted(set(roles))})

    def test_rejects_invalid_requests_before_contacting_ydb(self):
        invalid = [
            ({**request(), "headers": {}}, 401),
            ({**request(), "headers": {"Authorization": "Bearer " + "y" * 43}}, 401),
            ({**request(), "httpMethod": "GET"}, 405),
            ({**request(body="!"), "isBase64Encoded": True}, 400),
            (request(body='{"roles": [], "roles": []}'), 400),
            (request(body=" " * (receiver.MAX_BODY_BYTES + 1)), 400),
        ]
        base = {"revision": 1, "user": USER, "roles": []}
        invalid += [(request(snapshot=base | change), 400) for change in [
            {"revision": -1}, {"revision": True}, {"revision": 2**53}, {"revision": 1.5},
            {"user": USER | {"id": False}}, {"user": USER | {"telegramUserId": "0001"}},
            {"user": USER | {"telegramUserId": str(2**53)}}, {"user": USER | {"firstName": None}},
            {"user": USER | {"isPremium": 0}}, {"user": USER | {"admin": True}},
            {"roles": ["admin"]}, {"roles": "coach"}, {"scope": "admin"},
        ]]
        with patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}), patch.object(receiver, "runtime_store") as store:
            for event, status in invalid:
                with self.subTest(status=status, event=event):
                    self.assertEqual(receiver.handler(event, None)["statusCode"], status)
            store.assert_not_called()

    def test_conflict_and_unknown_commit_outcome_do_not_expose_data(self):
        with patch.dict(os.environ, {receiver.SECRET_ENV: SECRET}), patch.object(receiver, "runtime_store"), \
                patch.object(receiver, "save", side_effect=[("conflict", 1), TimeoutError("private details")]):
            response = receiver.handler(request(), None)
            self.assertEqual(response["statusCode"], 409)
            self.assertEqual(json.loads(response["body"]), {"error": {"code": "REVISION_CONFLICT"}, "revision": 1})
            response = receiver.handler(request(), None)
            self.assertEqual(response["statusCode"], 503)
            self.assertEqual(json.loads(response["body"]), {"error": {"code": "REPLICA_UNAVAILABLE"}})
