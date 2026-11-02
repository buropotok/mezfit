"""Contract checks for the read-only candidate generator.

Executed by GitHub Actions after PR creation, never on users' devices.
"""
import unittest

from build_data import add_evidence, title_score, words


class CandidateSourceTests(unittest.TestCase):
    def test_same_english_title_scores_one(self):
        self.assertAlmostEqual(title_score(words("Wheel Run"), words("wheel run")), 1.0)

    def test_plural_and_simple_synonym(self):
        self.assertAlmostEqual(title_score(words("Burpees"), words("burpee")), 1.0)
        self.assertGreater(title_score(words("Unilateral Bridge"), words("Single Leg Bridge")), 0.3)

    def test_nonidentical_movements_are_not_exact_title_matches(self):
        self.assertLess(title_score(words("Bicep Curl"), words("Cable Row")), 1.0)

    def test_independent_evidence_is_preserved(self):
        pairs = {"Wheel-Run.gif": {}}
        ids = {"3637"}
        add_evidence(pairs, ids, "Wheel-Run.gif", "3637", "visual", 0.65)
        add_evidence(pairs, ids, "Wheel-Run.gif", "3637", "visual", 0.45)
        add_evidence(pairs, ids, "Wheel-Run.gif", "3637", "pose", 0.8)
        add_evidence(pairs, ids, "Wheel-Run.gif", "9999", "pose", 0.9)
        self.assertEqual(pairs["Wheel-Run.gif"]["3637"], {"visual": 0.65, "pose": 0.8})
        self.assertNotIn("9999", pairs["Wheel-Run.gif"])


if __name__ == "__main__":
    unittest.main()
