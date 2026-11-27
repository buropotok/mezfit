"""YDB storage for one full snapshot per Mezfit account."""

from pathlib import Path

TABLE = "account_replica"
SCHEMA = Path(__file__).with_name("schema.yql")
UPSERT = """
DECLARE $telegram_id AS Utf8;
DECLARE $revision AS Uint64;
DECLARE $snapshot AS Utf8;
UPSERT INTO account_replica (telegram_id, revision, snapshot)
VALUES ($telegram_id, $revision, $snapshot);
"""


# Preserve the physical PK name to upgrade populated databases in place.
# For existing accounts the key is already the immutable Mezfit user_id.
IDENTITY_COLUMNS = {
    "external_telegram_id": "Utf8", "login": "Utf8", "pass_hash": "Utf8", "identity_state": "Utf8",
}

SELECT_CURRENT = """
DECLARE $telegram_id AS Utf8;
SELECT revision, snapshot, external_telegram_id, login, pass_hash, identity_state
FROM account_replica WHERE telegram_id = $telegram_id;
"""

WRITE_FULL = """
DECLARE $telegram_id AS Utf8;
DECLARE $revision AS Uint64;
DECLARE $snapshot AS Utf8;
DECLARE $external_telegram_id AS Utf8?;
DECLARE $login AS Utf8?;
DECLARE $pass_hash AS Utf8?;
DECLARE $identity_state AS Utf8;
UPSERT INTO account_replica
  (telegram_id, revision, snapshot, external_telegram_id, login, pass_hash, identity_state)
VALUES
  ($telegram_id, $revision, $snapshot, $external_telegram_id, $login, $pass_hash, $identity_state);
"""

FIND_CONFLICT = """
DECLARE $telegram_id AS Utf8;
DECLARE $external_telegram_id AS Utf8?;
DECLARE $login AS Utf8?;
SELECT telegram_id FROM account_replica
WHERE telegram_id != $telegram_id AND (
    ($external_telegram_id IS NOT NULL AND external_telegram_id = $external_telegram_id)
    OR ($login IS NOT NULL AND login = $login)
)
LIMIT 1;
"""


class ReplicaWriteError(Exception):
    def __init__(self, stage):
        super().__init__(stage)
        self.stage = stage


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
    table_path = f"{database}/{TABLE}"
    settings = ydb.BaseRequestSettings().with_timeout(5).with_operation_timeout(4)

    def check(session):
        if create:
            session.execute_scheme(SCHEMA.read_text(encoding="utf-8"), settings=settings)
        table = session.describe_table(table_path, settings=settings)
        baseline = {"telegram_id": "Utf8?", "revision": "Uint64?", "snapshot": "Utf8?"}
        expected = baseline | {name: kind + "?" for name, kind in IDENTITY_COLUMNS.items()}

        def check(table, *, complete):
            columns = {column.name: str(column.type) for column in table.columns}
            if (any(expected.get(name) != kind for name, kind in columns.items())
                    or not baseline.keys() <= columns.keys() or list(table.primary_key) != ["telegram_id"]
                    or table.indexes or table.ttl_settings or (complete and columns != expected)):
                raise ValueError("Unexpected account replica table schema.")
            return columns

        columns = check(table, complete=not create)
        missing = [f"ADD COLUMN {name} {kind}" for name, kind in IDENTITY_COLUMNS.items() if name not in columns]
        if create and missing:
            session.execute_scheme(f"ALTER TABLE {TABLE} " + ", ".join(missing) + ";", settings=settings)
            check(session.describe_table(table_path, settings=settings), complete=True)

    pool.retry_operation_sync(check, retry_settings=ydb.RetrySettings(max_retries=2, idempotent=True))


def save(store, telegram_id, revision, snapshot, identity=None):
    import ydb

    pool, _, _ = store
    settings = ydb.BaseRequestSettings().with_timeout(3).with_operation_timeout(2)

    stage = "SESSION"

    def transaction(session):
        nonlocal stage
        def prepare(query, step):
            nonlocal stage
            stage = step
            return session.prepare(query, settings=settings)

        select = prepare(SELECT_CURRENT, "PREPARE_READ")
        upsert = prepare(WRITE_FULL if identity else UPSERT, "PREPARE_WRITE")
        check_owners = identity and (identity[0] is not None or identity[1] is not None)
        conflict = prepare(FIND_CONFLICT, "PREPARE_READ") if check_owners else None
        params = {"$telegram_id": telegram_id, "$revision": revision, "$snapshot": snapshot}

        with session.transaction(ydb.SerializableReadWrite()) as tx:
            def finish(outcome, stored_revision):
                nonlocal stage
                stage = "COMMIT_READ"
                tx.commit(settings=settings)
                return outcome, stored_revision

            stage = "READ"
            rows = tx.execute(select, {"$telegram_id": telegram_id}, settings=settings)[0].rows
            if rows:
                row = rows[0]
                if row.revision > revision:
                    return finish("stale", row.revision)
                stored_identity = (row.external_telegram_id, row.login, row.pass_hash, row.identity_state)
                if not identity and row.identity_state is not None:
                    return finish("conflict", row.revision)
                if row.identity_state == "deleted" and identity[-1] != "deleted":
                    return finish("identity_conflict", row.revision)
                if row.revision == revision:
                    if not identity or row.identity_state is not None:
                        same = row.snapshot == snapshot and (identity is None or stored_identity == identity)
                        return finish("duplicate" if same else "conflict", row.revision)
                    # During rollout an older Worker may have delivered the profile at
                    # this exact revision before the full snapshot reached the receiver.
                    if row.snapshot != snapshot and identity[-1] != "deleted":
                        return finish("conflict", row.revision)

            if identity:
                external, login, verifier, state = identity
                params.update({
                    "$external_telegram_id": external, "$login": login,
                    "$pass_hash": verifier, "$identity_state": state,
                })
                if conflict is not None:
                    owners = tx.execute(conflict, {
                        "$telegram_id": telegram_id, "$external_telegram_id": external, "$login": login,
                    }, settings=settings)[0].rows
                    if owners:
                        return finish("identity_conflict", revision)

            stage = "WRITE_COMMIT"
            tx.execute(upsert, params, commit_tx=True, settings=settings)
            return "applied", revision

    try:
        return pool.retry_operation_sync(
            transaction,
            retry_settings=ydb.RetrySettings(max_retries=2, idempotent=True, max_session_acquire_timeout=2),
        )
    except Exception as exc:
        raise ReplicaWriteError(stage) from exc
