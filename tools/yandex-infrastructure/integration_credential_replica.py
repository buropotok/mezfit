"""Real serializable credential transactions against disposable CI YDB."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from threading import Barrier
import unittest

import ydb

sys.path.insert(0, str(Path(__file__).with_name("credential-replica")))
from credential_store import Snapshot, connect, save, verify_schema


class CredentialYdbContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = connect("grpc://localhost:2136", "/local", ydb.AnonymousCredentials(), timeout=75)
        pool, driver, _ = cls.store
        cls.addClassCleanup(driver.stop)
        cls.addClassCleanup(pool.stop)
        verify_schema(cls.store, create=True)
        verify_schema(cls.store, create=True)

    def test_revisions_and_tombstones_preserve_safe_integer_ids(self):
        first = Snapshot(2**53 - 1, None, None, "initial", "opaque-fixture", 1, "active")
        linked = first._replace(app_user_id=42, telegram_id=4251, login="updated",
                               pass_hash=None, revision=2)
        deleted = Snapshot(first.user_id, None, None, None, None, 3, "deleted")
        self.assertEqual(save(self.store, first), ("applied", 1))
        self.assertEqual(save(self.store, first), ("duplicate", 1))
        self.assertEqual(save(self.store, first._replace(login="conflict")), ("revision_conflict", 1))
        self.assertEqual(save(self.store, linked), ("applied", 2))
        self.assertEqual(save(self.store, first), ("stale", 2))
        self.assertEqual(save(self.store, linked), ("duplicate", 2))

        # Old login freed on update and the new login and the Telegram ID claimed together.
        other = Snapshot(2**52, None, None, "initial", "opaque-fixture", 1, "active")
        self.assertEqual(save(self.store, other), ("applied", 1))
        with self.subTest("duplicate Telegram"):
            self.assertEqual(save(self.store, other._replace(
                app_user_id=42, telegram_id=4251, revision=2,
            )), ("lookup_conflict", None))
        with self.subTest("duplicate login"):
            self.assertEqual(save(self.store, other._replace(login="updated", revision=2)), ("lookup_conflict", None))
        self.assertEqual(save(self.store, other), ("duplicate", 1))

        self.assertEqual(save(self.store, deleted), ("applied", 3))
        self.assertEqual(save(self.store, linked), ("stale", 3))
        self.assertEqual(save(self.store, linked._replace(revision=4)), ("deleted", 3))
        self.assertEqual(save(self.store, other._replace(login="updated", revision=2)), ("applied", 2))

    def test_concurrent_claims_never_create_two_owners(self):
        barrier = Barrier(2, timeout=10)

        def write(user_id):
            barrier.wait()
            return save(self.store, Snapshot(user_id, None, None, "shared", "opaque-fixture", 1, "active"))

        with ThreadPoolExecutor(2) as executor:
            futures = [executor.submit(write, 2**52 + offset) for offset in (10, 11)]
            outcomes = [future.result(timeout=30) for future in futures]
        self.assertCountEqual(outcomes, [("applied", 1), ("lookup_conflict", None)])


if __name__ == "__main__":
    unittest.main()
