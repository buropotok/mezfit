"""Serializable updates of a credential snapshot and its unique lookup keys."""

from pathlib import Path
from typing import NamedTuple


class Snapshot(NamedTuple):
    user_id: int
    app_user_id: int | None
    telegram_id: int | None
    login: str | None
    pass_hash: str | None
    revision: int
    state: str


TABLES = {
    "credential_replica": ("user_id", {
        "user_id": "Uint64", "app_user_id": "Uint64", "telegram_id": "Uint64",
        "login": "Utf8", "pass_hash": "Utf8", "revision": "Uint64", "state": "Utf8",
    }),
    "credential_replica_login": ("login", {"login": "Utf8", "user_id": "Uint64"}),
    "credential_replica_telegram": ("telegram_id", {"telegram_id": "Uint64", "user_id": "Uint64"}),
}

LOOKUPS = (
    ("credential_replica_login", "login", "Utf8"),
    ("credential_replica_telegram", "telegram_id", "Uint64"),
)

READ = """
DECLARE $user_id AS Uint64;
SELECT user_id, app_user_id, telegram_id, login, pass_hash, revision, state
FROM credential_replica WHERE user_id = $user_id;
"""

WRITE = """
DECLARE $user_id AS Uint64;
DECLARE $app_user_id AS Uint64?;
DECLARE $telegram_id AS Uint64?;
DECLARE $login AS Utf8?;
DECLARE $pass_hash AS Utf8?;
DECLARE $revision AS Uint64;
DECLARE $state AS Utf8;
UPSERT INTO credential_replica (user_id, app_user_id, telegram_id, login, pass_hash, revision, state)
VALUES ($user_id, $app_user_id, $telegram_id, $login, $pass_hash, $revision, $state);
"""


def connect(endpoint, database, credentials, *, timeout=5):
    import ydb

    driver = ydb.Driver(endpoint=endpoint, database=database, credentials=credentials)
    try:
        driver.wait(timeout=timeout, fail_fast=False)
    except Exception:
        driver.stop()
        raise
    return ydb.SessionPool(driver, size=4), driver, database


def verify_schema(store, *, create=False):
    import ydb

    pool, _, database = store
    settings = ydb.BaseRequestSettings().with_timeout(5).with_operation_timeout(4)

    def inspect(session):
        if create:
            schema = Path(__file__).with_name("schema.yql").read_text(encoding="utf-8")
            for statement in filter(str.strip, schema.split(";")):
                session.execute_scheme(statement + ";", settings=settings)
        for name, (key, types) in TABLES.items():
            table = session.describe_table(f"{database}/{name}", settings=settings)
            columns = {column.name: str(column.type) for column in table.columns}
            expected = {column: kind + "?" for column, kind in types.items()}
            if columns != expected or list(table.primary_key) != [key] or table.indexes or table.ttl_settings:
                raise ValueError("CREDENTIAL_SCHEMA_MISMATCH")

    pool.retry_operation_sync(inspect, retry_settings=ydb.RetrySettings(max_retries=1, idempotent=True))


def save(store, snapshot):
    import ydb

    pool, _, _ = store
    settings = ydb.BaseRequestSettings().with_timeout(2).with_operation_timeout(1)

    def transaction(session):
        with session.transaction(ydb.SerializableReadWrite()) as tx:
            def execute(query, parameters, *, commit=False):
                return tx.execute(session.prepare(query, settings=settings), parameters,
                                  commit_tx=commit, settings=settings)

            def finish(outcome, revision):
                tx.commit(settings=settings)
                return outcome, revision

            rows = execute(READ, {"$user_id": snapshot.user_id})[0].rows
            current = Snapshot(*(getattr(rows[0], field) for field in Snapshot._fields)) if rows else None
            if current:
                if current.revision > snapshot.revision:
                    return finish("stale", current.revision)
                if current.revision == snapshot.revision:
                    return finish("duplicate" if current == snapshot else "revision_conflict", current.revision)
                if current.state == "deleted":
                    return finish("deleted", current.revision)

            changes = []
            for table, field, kind in LOOKUPS:
                before = getattr(current, field) if current else None
                after = getattr(snapshot, field)
                if before == after:
                    continue
                declare = f"DECLARE $key AS {kind};"
                owner_query = f"{declare} SELECT user_id FROM {table} WHERE {field} = $key;"
                if before is not None:
                    owners = execute(owner_query, {"$key": before})[0].rows
                    if not owners or owners[0].user_id != snapshot.user_id:
                        return finish("lookup_conflict", None)
                if after is not None:
                    owners = execute(owner_query, {"$key": after})[0].rows
                    if owners and owners[0].user_id != snapshot.user_id:
                        return finish("lookup_conflict", None)
                changes.append((table, field, declare, before, after))

            for table, field, declare, before, after in changes:
                if before is not None:
                    execute(f"{declare} DELETE FROM {table} WHERE {field} = $key;",
                            {"$key": before})
                if after is not None:
                    execute(f"""
                        {declare}
                        DECLARE $user_id AS Uint64;
                        UPSERT INTO {table} ({field}, user_id) VALUES ($key, $user_id);
                    """, {"$key": after, "$user_id": snapshot.user_id})

            execute(WRITE, {"$" + key: value for key, value in snapshot._asdict().items()}, commit=True)
            return "applied", snapshot.revision

    return pool.retry_operation_sync(
        transaction, retry_settings=ydb.RetrySettings(max_retries=1, idempotent=True, max_session_acquire_timeout=2),
    )
