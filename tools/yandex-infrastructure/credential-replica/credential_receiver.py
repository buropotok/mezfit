"""Private server-to-server receiver. Responses contain only status and revision."""

import base64
from functools import lru_cache
import hmac
import json
import os
import re
from uuid import uuid4

from credential_store import Snapshot, connect, save, verify_schema

SECRET_ENV = "MEZFIT_CREDENTIAL_REPLICATION_SECRET"
SECRET = re.compile(r"[a-zA-Z0-9_-]{43}")
ID = re.compile(r"[1-9][0-9]{0,15}")
LOGIN = re.compile(r"[a-z0-9_]{1,32}")
# Check the encoded format only. Password verification and cost policy are a later stage.
HASH = re.compile(r"\$argon2id\$v=19\$m=[1-9][0-9]{0,8},t=[1-9][0-9]{0,8},p=[1-9][0-9]{0,8}"
                  r"\$[A-Za-z0-9+/]{11,128}\$[A-Za-z0-9+/]{22,256}")
MAX_BODY = 2048
PASSWORD_ID_MIN = 2**52
MAX_ID = 2**53 - 1
ERROR_CODES = {
    "revision_conflict": "REVISION_CONFLICT", "lookup_conflict": "LOOKUP_CONFLICT", "deleted": "ID_DELETED",
}


def reply(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, separators=(",", ":")),
    }


def failure(status, code, revision=None):
    # Generate correlation IDs here so arbitrary caller identifiers cannot enter logs.
    request_id = str(uuid4())
    print(json.dumps({"event": "CREDENTIAL_REPLICA_FAILURE", "code": code, "request_id": request_id}))
    body = {"error": {"code": code}}
    if revision is not None:
        body["revision"] = revision
    response = reply(status, body)
    response["headers"]["X-Mezfit-Credential-Request-Id"] = request_id
    return response


def authorized(event, secret):
    headers = event.get("headers")
    if not isinstance(headers, dict):
        return False
    values = [value for name, value in headers.items() if name.lower() == "authorization"]
    if len(values) != 1 or not isinstance(values[0], str):
        return False
    scheme, _, token = values[0].partition(" ")
    return scheme.lower() == "bearer" and SECRET.fullmatch(token) and hmac.compare_digest(secret, token)


def unique_fields(items):
    fields = {}
    for key, value in items:
        if key in fields:
            raise ValueError("DUPLICATE_FIELD")
        fields[key] = value
    return fields


def parse_id(value, limit):
    if not isinstance(value, str) or not ID.fullmatch(value) or int(value) > limit:
        raise ValueError("INVALID_ID")
    return int(value)


def parse_snapshot(event):
    body = event.get("body")
    if not isinstance(body, str) or len(body) > 4 * ((MAX_BODY + 2) // 3):
        raise ValueError("INVALID_BODY")
    raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") is True else body.encode("utf-8")
    if len(raw) > MAX_BODY:
        raise ValueError("BODY_TOO_LARGE")
    payload = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(payload, dict) or payload.keys() != set(Snapshot._fields):
        raise ValueError("INVALID_FIELDS")

    user = parse_id(payload["user_id"], MAX_ID)
    app, telegram = payload["app_user_id"], payload["telegram_id"]
    login, verifier, revision, state = (payload[key] for key in ("login", "pass_hash", "revision", "state"))
    if type(revision) is not int or not 1 <= revision <= MAX_ID or state not in ("active", "disabled", "deleted"):
        raise ValueError("INVALID_VERSION_OR_STATE")
    if (app is None) != (telegram is None):
        raise ValueError("INCOMPLETE_TELEGRAM_LINK")
    if app is not None:
        app = parse_id(app, MAX_ID)
        telegram = parse_id(telegram, PASSWORD_ID_MIN - 1)
    if state == "deleted":
        if any(value is not None for value in (app, telegram, login, verifier)):
            raise ValueError("INVALID_TOMBSTONE")
    elif user < PASSWORD_ID_MIN and user != telegram:
        raise ValueError("INVALID_TELEGRAM_MAPPING")
    if login is not None and (not isinstance(login, str) or not LOGIN.fullmatch(login)):
        raise ValueError("INVALID_LOGIN")
    if verifier is not None and (state != "active" or login is None
                                 or not isinstance(verifier, str) or not HASH.fullmatch(verifier)):
        raise ValueError("INVALID_VERIFIER")
    return Snapshot(user, app, telegram, login, verifier, revision, state)


@lru_cache(maxsize=1)
def runtime_store():
    import ydb.iam

    return connect(os.environ["YDB_ENDPOINT"], os.environ["YDB_DATABASE"], ydb.iam.MetadataUrlCredentials())


def handler(event, context):
    if not isinstance(event, dict):
        return failure(400, "INVALID_REQUEST")
    secret = os.environ.get(SECRET_ENV, "")
    if not SECRET.fullmatch(secret):
        return failure(503, "REPLICATION_NOT_CONFIGURED")
    method = event.get("httpMethod")
    # This GET is only for the IAM-authorized direct deployment probe.
    query = event.get("queryStringParameters")
    if method == "GET" and isinstance(query, dict) and query.get("readiness") == "1":
        try:
            verify_schema(runtime_store())
        except Exception:
            return failure(503, "REPLICA_NOT_READY")
        return reply(200, {"status": "ready"})
    if method != "POST":
        return failure(405, "METHOD_NOT_ALLOWED")
    if not authorized(event, secret):
        return failure(401, "UNAUTHORIZED")

    try:
        snapshot = parse_snapshot(event)
    except (ValueError, RecursionError):
        return failure(400, "INVALID_SNAPSHOT")
    try:
        outcome, revision = save(runtime_store(), snapshot)
    except Exception:
        return failure(503, "REPLICA_UNAVAILABLE")
    if outcome in ERROR_CODES:
        return failure(409, ERROR_CODES[outcome], revision)
    return reply(200, {"status": outcome, "revision": revision})
