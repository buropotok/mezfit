"""Verify account replica writes through the deployed Gateway."""

from contextlib import closing
from http.client import HTTPSConnection, HTTPException
import json
import os
import re
import sys

HOST = "mezfit.online"
ROUTE = "/api/internal/account-replication"
# Telegram Bot API user IDs have at most 52 significant bits. The receiver
# accepts safe integers through 2**53 - 1, leaving room for an isolated fixture.
FIXTURE_ID_BASE = 2**52


def verify_request(snapshot, secret, expected_status, expected_revision):
    body = json.dumps(snapshot, separators=(",", ":")).encode("utf-8")
    try:
        # Send the bearer only to this HTTPS host. HTTPConnection follows no redirects.
        with closing(HTTPSConnection(HOST, timeout=15)) as connection:
            connection.request("POST", ROUTE, body, {
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            })
            response = connection.getresponse()
            http_status = response.status
            if http_status != 200:
                print(f"- FAIL: expected `{expected_status}`, received HTTP {http_status}.")
                return False
            raw = response.read(4097)
    except (OSError, HTTPException):
        print(f"- FAIL: no complete HTTP response while checking `{expected_status}`.")
        return False

    try:
        result = json.loads(raw) if len(raw) <= 4096 else None
    except (ValueError, RecursionError):
        result = None
    if (not isinstance(result, dict) or result.get("status") != expected_status
            or type(result.get("revision")) is not int or result["revision"] != expected_revision):
        print(f"- FAIL: HTTP 200 did not confirm `{expected_status}` at revision {expected_revision}.")
        return False
    print(f"- HTTP 200 · `{expected_status}` · revision {expected_revision}")
    return True


def main():
    print("### Yandex account replica")
    secret = os.environ.get("MEZFIT_ACCOUNT_REPLICATION_SECRET", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", secret):
        print("- FAIL: configure the existing `MEZFIT_ACCOUNT_REPLICATION_SECRET` Actions secret.")
        return 1

    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not re.fullmatch(r"[1-9][0-9]{0,15}", run_id) or not re.fullmatch(r"[1-9][0-9]{0,15}", attempt):
        print("- FAIL: GitHub Actions run metadata is missing or invalid.")
        return 1
    if int(run_id) >= FIXTURE_ID_BASE or int(attempt) >= FIXTURE_ID_BASE:
        print("- FAIL: GitHub Actions run metadata exceeds the replica's safe-integer range.")
        return 1

    fixture_id = FIXTURE_ID_BASE + int(run_id)
    # A retry of the same GitHub run reuses its row and submits a higher revision.
    revision = int(attempt) + 1
    user = {
        "id": fixture_id,
        "telegramUserId": str(fixture_id),
        "username": None,
        "firstName": "Mezfit replica smoke",
        "lastName": None,
        "languageCode": None,
        "photoUrl": None,
        "isPremium": False,
    }
    current = {"user": user, "roles": ["client"], "revision": revision}
    older = {"user": user, "roles": [], "revision": revision - 1}
    for snapshot, status in ((current, "applied"), (current, "duplicate"), (older, "stale")):
        if not verify_request(snapshot, secret, status, revision):
            return 1
    print("\n**PASS** · applied → duplicate → stale")
    return 0


if __name__ == "__main__":
    sys.exit(main())
