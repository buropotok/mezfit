"""Private Cloud Function receiving verified account snapshots from D1."""

import base64
import binascii
from functools import lru_cache
import hmac
import json
import os
import re
from uuid import uuid4

from replica_store import ReplicaWriteError, connect, save, verify_schema

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
REQUEST_ID_HEADER = "x-mezfit-replica-request-id"
DETAIL_HEADER = "x-mezfit-replica-error-detail"
REQUEST_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
YDB_ERROR_KINDS = {
    "Unauthenticated": "AUTHENTICATION", "Unauthorized": "PERMISSION",
    "ConnectionFailure": "CONNECTION", "ConnectionLost": "CONNECTION", "ConnectionError": "CONNECTION",
    "DeadlineExceed": "TIMEOUT", "Timeout": "TIMEOUT",
    "Unavailable": "UNAVAILABLE", "Overloaded": "OVERLOADED", "SchemeError": "SCHEMA",
    "BadRequest": "BAD_QUERY", "PreconditionFailed": "PRECONDITION", "Aborted": "ABORTED",
    "SessionPoolEmpty": "SESSION_POOL_EMPTY", "BadSession": "BAD_SESSION",
    "Undetermined": "COMMIT_UNKNOWN", "InternalError": "INTERNAL",
}


class SnapshotError(ValueError):
    pass


def request_id(event):
    headers = event.get("headers")
    if isinstance(headers, dict):
        values = [value for name, value in headers.items() if name.lower() == REQUEST_ID_HEADER]
        if len(values) == 1 and isinstance(values[0], str) and REQUEST_ID.fullmatch(values[0]):
            return values[0]
    return str(uuid4())


def failure(status, body, correlation_id, detail=None):
    response = reply(status, body)
    response["headers"][REQUEST_ID_HEADER] = correlation_id
    if detail:
        response["headers"][DETAIL_HEADER] = detail
    print(json.dumps({
        "event": "ACCOUNT_REPLICA_FAILURE", "request_id": correlation_id,
        "http_status": status, "code": body["error"]["code"], "detail": detail,
    }))
    return response


def ydb_error_kind(exc):
    if isinstance(exc, TimeoutError):
        return "TIMEOUT"
    return YDB_ERROR_KINDS.get(type(exc).__name__, "UNCLASSIFIED")


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
            raise SnapshotError("DUPLICATE_FIELD")
        value[name] = field
    return value


def read_snapshot(event):
    body = event.get("body")
    if not isinstance(body, str) or len(body) > 4 * ((MAX_BODY_BYTES + 2) // 3):
        raise SnapshotError("BODY_TYPE_OR_SIZE")
    raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") is True else body.encode("utf-8")
    if len(raw) > MAX_BODY_BYTES:
        raise SnapshotError("BODY_TOO_LARGE")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(value, dict) or value.keys() != {"revision", "user", "roles"}:
        raise SnapshotError("SNAPSHOT_SHAPE")

    user, roles, revision = value["user"], value["roles"], value["revision"]
    if not positive_safe_integer(revision):
        raise SnapshotError("REVISION")
    if not isinstance(user, dict) or user.keys() != USER_FIELDS:
        raise SnapshotError("USER_SHAPE")
    telegram_id = user["telegramUserId"]
    if (not isinstance(telegram_id, str) or not re.fullmatch(r"[1-9][0-9]{0,15}", telegram_id)
            or int(telegram_id) > MAX_SAFE_INTEGER):
        raise SnapshotError("TELEGRAM_ID")
    if not positive_safe_integer(user["id"]):
        raise SnapshotError("D1_ID")
    if type(user["isPremium"]) is not bool:
        raise SnapshotError("IS_PREMIUM")
    for key, limit in STRING_LIMITS.items():
        field = user[key]
        if field is None and key != "firstName":
            continue
        if not isinstance(field, str) or len(field) > limit:
            raise SnapshotError(key)
        try:
            field.encode("utf-8")  # Reject escaped lone surrogates.
        except UnicodeError:
            raise SnapshotError(key) from None
    if not isinstance(roles, list) or len(roles) > 2 or any(role not in ROLE_NAMES for role in roles):
        raise SnapshotError("ROLES")
    snapshot = {"user": user, "roles": [role for role in ROLE_NAMES if role in roles]}
    return telegram_id, revision, json.dumps(snapshot, sort_keys=True, separators=(",", ":"))


@lru_cache(maxsize=1)
def runtime_store():
    import ydb.iam

    return connect(os.environ["YDB_ENDPOINT"], os.environ["YDB_DATABASE"],
                   ydb.iam.MetadataUrlCredentials())


def handler(event, context):
    correlation_id = request_id(event)
    secret = os.environ.get(SECRET_ENV, "")
    if not SECRET_PATTERN.fullmatch(secret):
        return failure(503, {"error": {"code": "REPLICATION_NOT_CONFIGURED"}}, correlation_id)
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
        response = error(401, "UNAUTHORIZED")
        response["headers"][REQUEST_ID_HEADER] = correlation_id
        return response
    try:
        telegram_id, revision, snapshot = read_snapshot(event)
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, SnapshotError):
            detail = str(exc)
        elif isinstance(exc, binascii.Error):
            detail = "BODY_BASE64"
        elif isinstance(exc, UnicodeError):
            detail = "BODY_ENCODING"
        else:
            detail = "BODY_JSON"
        return failure(400, {"error": {"code": "INVALID_SNAPSHOT"}}, correlation_id, detail)

    unavailable = {"error": {"code": "REPLICA_UNAVAILABLE"}}
    try:
        store = runtime_store()
    except KeyError:
        return failure(503, unavailable, correlation_id, "CONNECT:CONFIG_MISSING")
    except Exception as exc:
        return failure(503, unavailable, correlation_id, f"CONNECT:{ydb_error_kind(exc)}")
    try:
        outcome, stored_revision = save(store, telegram_id, revision, snapshot)
    except ReplicaWriteError as exc:
        return failure(503, unavailable, correlation_id, f"{exc.stage}:{ydb_error_kind(exc.__cause__)}")
    except Exception as exc:
        return failure(503, unavailable, correlation_id, f"WRITE:{ydb_error_kind(exc)}")
    if outcome == "conflict":
        return failure(409, {"error": {"code": "REVISION_CONFLICT"}, "revision": stored_revision}, correlation_id)
    return reply(200, {"status": outcome, "revision": stored_revision})
