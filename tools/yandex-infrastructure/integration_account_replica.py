"""Real YDB transaction contracts against the disposable CI database."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
from threading import Barrier
import unittest

import ydb

sys.path.insert(0, str(Path(__file__).with_name("account-replica")))
from replica_store import connect, save, verify_schema


class ReplicaYdbContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = connect("grpc://localhost:2136", "/local", ydb.AnonymousCredentials(), timeout=75)
        pool, driver, _ = cls.store
        cls.addClassCleanup(driver.stop)
        cls.addClassCleanup(pool.stop)
        verify_schema(cls.store, create=True)
        verify_schema(cls.store, create=True)

    def test_retry_old_and_conflicting_snapshots(self):
        key = "12301"
        snapshot = json.dumps({"user": {"id": 12, "telegramUserId": key}, "roles": []})
        newer = json.dumps({"user": {"id": 12, "telegramUserId": key}, "roles": ["coach"]})
        self.assertEqual(save(self.store, key, 1, snapshot), ("applied", 1))
        # A sender can lose the response after commit and send the same revision again.
        self.assertEqual(save(self.store, key, 1, snapshot), ("duplicate", 1))
        self.assertEqual(save(self.store, key, 1, newer), ("conflict", 1))
        self.assertEqual(save(self.store, key, 2, newer), ("applied", 2))
        self.assertEqual(save(self.store, key, 1, snapshot), ("stale", 2))
        self.assertEqual(save(self.store, key, 2, newer), ("duplicate", 2))

    def test_concurrent_writers_never_regress_or_replace_equal_revision(self):
        def race(key, versions):
            barrier = Barrier(2, timeout=10)

            def write(version, payload):
                barrier.wait()
                return save(self.store, key, version, payload)

            with ThreadPoolExecutor(2) as executor:
                futures = [executor.submit(write, revision, content) for revision, content in versions]
                return [future.result(timeout=30) for future in futures]

        result = race("12302", [(1, "{}"), (2, '{"roles":["coach"]}')])
        self.assertEqual(result[1], ("applied", 2))
        self.assertIn(result[0], [("applied", 1), ("stale", 2)])
        self.assertEqual(save(self.store, "12302", 1, "{}"), ("stale", 2))

        result = race("12303", [(1, "{}"), (1, '{"roles":["coach"]}')])
        self.assertCountEqual(result, [("applied", 1), ("conflict", 1)])


if __name__ == "__main__":
    unittest.main()
