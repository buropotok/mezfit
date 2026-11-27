"""Upgrade the existing table and verify transaction semantics on disposable YDB."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from threading import Barrier
import unittest

import ydb

sys.path.insert(0, str(Path(__file__).with_name("account-replica")))
from replica_store import connect, save, verify_schema


class FullReplicaContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = connect("grpc://localhost:2136", "/local", ydb.AnonymousCredentials(), timeout=75)
        pool, driver, _ = cls.store
        cls.addClassCleanup(driver.stop)
        cls.addClassCleanup(pool.stop)
        verify_schema(cls.store, create=True)

    def test_promotes_existing_row_and_revokes_verifier_without_losing_profile(self):
        key, profile = "45677", '{"roles":["client"],"user":{"id":1}}'
        verifier = (key, "old_login", "opaque-fixture", "active")
        revoked = (key, None, None, "active")
        self.assertEqual(save(self.store, key, 1, profile), ("applied", 1))
        self.assertEqual(save(self.store, key, 1, profile, verifier), ("applied", 1))
        self.assertEqual(save(self.store, key, 1, profile, verifier), ("duplicate", 1))
        self.assertEqual(save(self.store, key, 2, profile), ("conflict", 1))
        self.assertEqual(save(self.store, key, 2, profile, revoked), ("applied", 2))
        self.assertEqual(save(self.store, key, 1, profile, verifier), ("stale", 2))
        self.assertEqual(save(self.store, key, 2, profile, verifier), ("conflict", 2))
        self.assertEqual(save(self.store, key, 2, profile, revoked), ("duplicate", 2))

    def test_tombstone_preserves_high_id_and_is_terminal(self):
        key = str(2**53 - 1)
        identity = (None, "unlinked", "opaque-fixture", "active")
        tombstone = (None, None, None, "deleted")
        self.assertEqual(save(self.store, key, 1, "{}", identity), ("applied", 1))
        self.assertEqual(save(self.store, key, 2, "{}", tombstone), ("applied", 2))
        self.assertEqual(save(self.store, key, 3, "{}", identity), ("identity_conflict", 2))

    def test_concurrent_login_claims_are_exclusive(self):
        barrier = Barrier(2, timeout=10)

        def claim(offset):
            barrier.wait()
            return save(self.store, str(2**52 + offset), 1, "{}", (None, "shared", "opaque-fixture", "active"))

        with ThreadPoolExecutor(2) as executor:
            result = list(executor.map(claim, [21, 22]))
        self.assertCountEqual(result, [("applied", 1), ("identity_conflict", 1)])


if __name__ == "__main__":
    unittest.main()
