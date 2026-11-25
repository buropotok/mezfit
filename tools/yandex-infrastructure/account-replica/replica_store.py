"""YDB storage for one full snapshot per Telegram account."""

from pathlib import Path

TABLE = "account_replica"
SCHEMA = Path(__file__).with_name("schema.yql")
SELECT = """
DECLARE $telegram_id AS Utf8;
SELECT revision, snapshot FROM account_replica WHERE telegram_id = $telegram_id;
"""
UPSERT = """
DECLARE $telegram_id AS Utf8;
DECLARE $revision AS Uint64;
DECLARE $snapshot AS Utf8;
UPSERT INTO account_replica (telegram_id, revision, snapshot)
VALUES ($telegram_id, $revision, $snapshot);
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
    table_path = f"{database}/{TABLE}"
    settings = ydb.BaseRequestSettings().with_timeout(5).with_operation_timeout(4)

    def check(session):
        if create:
            session.execute_scheme(SCHEMA.read_text(encoding="utf-8"), settings=settings)
        table = session.describe_table(table_path, settings=settings)
        columns = {column.name: str(column.type) for column in table.columns}
        if (columns != {"telegram_id": "Utf8?", "revision": "Uint64?", "snapshot": "Utf8?"}
                or list(table.primary_key) != ["telegram_id"] or table.indexes or table.ttl_settings):
            raise ValueError("Unexpected account replica table schema.")

    pool.retry_operation_sync(check, retry_settings=ydb.RetrySettings(max_retries=2, idempotent=True))


def save(store, telegram_id, revision, snapshot):
    import ydb

    pool, _, _ = store
    settings = ydb.BaseRequestSettings().with_timeout(3).with_operation_timeout(2)

    def transaction(session):
        select = session.prepare(SELECT, settings=settings)
        upsert = session.prepare(UPSERT, settings=settings)
        with session.transaction(ydb.SerializableReadWrite()) as tx:
            rows = tx.execute(select, {"$telegram_id": telegram_id}, settings=settings)[0].rows
            if rows:
                row = rows[0]
                if row.revision > revision:
                    tx.commit(settings=settings)
                    return "stale", row.revision
                if row.revision == revision:
                    tx.commit(settings=settings)
                    return ("duplicate" if row.snapshot == snapshot else "conflict"), row.revision
            tx.execute(upsert, {"$telegram_id": telegram_id, "$revision": revision, "$snapshot": snapshot},
                       commit_tx=True, settings=settings)
            return "applied", revision

    return pool.retry_operation_sync(transaction,
                                     retry_settings=ydb.RetrySettings(
                                         max_retries=2, idempotent=True, max_session_acquire_timeout=2))
