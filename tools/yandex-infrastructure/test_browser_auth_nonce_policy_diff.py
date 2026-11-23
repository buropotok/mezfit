import copy
import unittest

from deploy_browser_auth import deploy_nonce_bucket_policy, nonce_policy_readback_diff
from test_deploy_browser_auth import FOLDER, RUNTIME_SA, SA


class NoncePolicyReadbackDiff(unittest.TestCase):
    def setUp(self):
        self.expected = deploy_nonce_bucket_policy(FOLDER, SA, RUNTIME_SA)
        self.actual = copy.deepcopy(self.expected)

    def test_reports_fields_using_expected_resource_even_when_rules_are_reordered(self):
        runtime, deploy = self.actual["Statement"]
        self.actual["Statement"] = [deploy, runtime]
        runtime["Resource"] = runtime["Resource"][0]
        runtime["Condition"]["Null"].clear()
        deploy["Action"].remove("s3:GetBucketAcl")
        deploy["Action"].append("unrecognized-action")
        deploy["Principal"]["CanonicalUser"] = ["account-do-not-log"]
        deploy["Condition"]["Bool"]["unexpected-condition-do-not-log"] = "unexpected-value"
        report = nonce_policy_readback_diff(self.actual, self.expected)
        self.assertIn("expected rule 1: Resource, Condition", report)
        self.assertIn("Null.s3:if-none-match missing", report)
        self.assertIn("expected rule 2: Principal, Action, Condition", report)
        self.assertIn("missing actions [s3:GetBucketAcl], unexpected actions 1", report)
        self.assertNotIn("do-not-log", report)
        self.assertNotIn("unrecognized-action", report)

    def test_recognizes_statement_order_without_marking_rules_as_changed(self):
        self.actual["Statement"].reverse()
        self.assertEqual(nonce_policy_readback_diff(self.actual, self.expected), "statement order")

    def test_reports_when_the_policy_is_not_in_the_expected_shape(self):
        self.assertEqual(nonce_policy_readback_diff({"Policy": "do-not-log"}, self.expected),
                         "Version, unexpected top-level fields, Statement is missing or invalid")
