"""Private Cloud Function receiving verified account snapshots from D1."""

import base64
import binascii
from functools import lru_cache
import hmac
import json
import os
import re

from replica_store import connect, save, verify_schema

SECRET_ENV = "MEZFIT_ACCOUNT_REPLICATION_SECRET"
SECRET_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")
MAX_SAFE_INTEGER = 2**53 - 1
MAX_BODY_BYTES = 32768
ROLE_NAMES = ("client", "coach")
STRING_LIMITS = {
    "username": 256, "firstName": 256, "lastName": 256,
    "languageCode": 64, "photoUrl": 4096,
}
USER_FIELDS = {*STRING_LIMITS, "id", "telegramUserId", "isPremium"}


def reply(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        "isBase64Encoded": False,
        "body": json.dumps(body, separators=(",", ":")),
    }


def error(status, code):
    return reply(status, {"error": {"code": code}})


def authorization(event, secret):
    headers = event.get("headers")
    if not isinstance(headers, dict):
        return False
    values = [value for name, value in headers.items() if name.lower() == "authorization"]
    if len(values) != 1 or not isinstance(values[0], str):
        return False
    scheme, _, token = values[0].partition(" ")
    return (scheme.lower() == "bearer" and SECRET_PATTERN.fullmatch(token)
            and hmac.compare_digest(secret, token))


def positive_safe_integer(value):
    return type(value) is int and 1 <= value <= MAX_SAFE_INTEGER


def unique_fields(items):
    value = {}
    for name, field in items:
        if name in value:
            raise ValueError("Repeated field")
        value[name] = field
    return value


def read_snapshot(event):
    body = event.get("body")
    if not isinstance(body, str) or len(body) > 4 * ((MAX_BODY_BYTES + 2) // 3):
        raise ValueError("Body size or type")
    raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") is True else body.encode("utf-8")
    if len(raw) > MAX_BODY_BYTES:
        raise ValueError("Body size")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(value, dict) or value.keys() != {"revision", "user", "roles"}:
        raise ValueError("Snapshot shape")

    user, roles, revision = value["user"], value["roles"], value["revision"]
    if not isinstance(user, dict) or user.keys() != USER_FIELDS or not positive_safe_integer(revision):
        raise ValueError("User shape or revision")
    telegram_id = user["telegramUserId"]
    if (not isinstance(telegram_id, str) or not re.fullmatch(r"[1-9][0-9]{0,15}", telegram_id)
            or int(telegram_id) > MAX_SAFE_INTEGER or not positive_safe_integer(user["id"])
            or type(user["isPremium"]) is not bool):
        raise ValueError("User identity or premium flag")
    for key, limit in STRING_LIMITS.items():
        field = user[key]
        if field is None and key != "firstName":
            continue
        if not isinstance(field, str) or len(field) > limit:
            raise ValueError("Invalid text field")
        field.encode("utf-8")  # Reject escaped lone surrogates.
    if not isinstance(roles, list) or len(roles) > 2 or any(role not in ROLE_NAMES for role in roles):
        raise ValueError("Invalid roles")
    snapshot = {"user": user, "roles": [role for role in ROLE_NAMES if role in roles]}
    return telegram_id, revision, json.dumps(snapshot, sort_keys=True, separators=(",", ":"))


@lru_cache(maxsize=1)
def runtime_store():
    import ydb.iam

    return connect(os.environ["YDB_ENDPOINT"], os.environ["YDB_DATABASE"],
                   ydb.iam.MetadataUrlCredentials())


def handler(event, context):
    secret = os.environ.get(SECRET_ENV, "")
    if not SECRET_PATTERN.fullmatch(secret):
        return error(503, "REPLICATION_NOT_CONFIGURED")
    # A direct IAM-authorized Cloud Functions invocation checks only schema.
    # The public gateway has no GET integration for this function.
    query = event.get("queryStringParameters")
    if event.get("httpMethod") == "GET" and isinstance(query, dict) and query.get("readiness") == "1":
        try:
            verify_schema(runtime_store())
        except Exception:
            return error(503, "REPLICA_NOT_READY")
        return reply(200, {"status": "ready"})
    if event.get("httpMethod") != "POST":
        return error(405, "METHOD_NOT_ALLOWED")
    if not authorization(event, secret):
        return error(401, "UNAUTHORIZED")
    try:
        telegram_id, revision, snapshot = read_snapshot(event)
    except (ValueError, UnicodeError, binascii.Error, RecursionError):
        return error(400, "INVALID_SNAPSHOT")
    try:
        outcome, stored_revision = save(runtime_store(), telegram_id, revision, snapshot)
    except Exception:
        return error(503, "REPLICA_UNAVAILABLE")
    if outcome == "conflict":
        return reply(409, {"error": {"code": "REVISION_CONFLICT"}, "revision": stored_revision})
    return reply(200, {"status": outcome, "revision": stored_revision})
