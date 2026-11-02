"""Ranking v2 requirements: synthetic contracts, independent of the old audit labels.

These tests protect ranking behavior; they do not declare GIFs visually identical.
"""
import unittest

from build_data import order_candidates, title_class, title_score, words


class SemanticRankingTests(unittest.TestCase):
    def test_name_normalization_keeps_motion_and_ignores_variant_suffix(self):
        self.assertEqual(words("Dumbbell Front Raise v. 2"), words("Dumbbell-Front-Raise"))
        self.assertEqual(words("Push-Up"), words("pushups"))
        self.assertEqual(words("Ring Dips"), words("ring dip"))
        self.assertEqual(words("Cable Forward Raise"), words("Cable Front Raise"))

    def test_action_conflict_reduces_false_squat_deadlift_similarity(self):
        same_action = title_score(words("Dumbbell Squat"), words("Dumbbell Bench Squat"))
        opposite_action = title_score(words("Dumbbell Squat"), words("Dumbbell Deadlift"))
        self.assertGreater(same_action, 0.5)
        self.assertLess(opposite_action, 0.2)
        self.assertGreater(same_action, opposite_action)

    def test_synonymous_single_leg_bridge_is_strong_semantic_candidate(self):
        actual = words("Unilateral Bridge")
        target = words("Single Leg Bridge With Outstretched Leg")
        self.assertGreater(title_score(actual, target), 0.5)
        self.assertGreaterEqual(title_class(actual, target), 1)

    def test_exact_name_precedes_visual_false_positives(self):
        r2 = {
            "0001": words("Dumbbell Squat"),
            "0002": words("Dumbbell Deadlift"),
            "0003": words("One Leg Squat"),
            "0004": words("Barbell Squat"),
            "0005": words("Leg Press"),
            "0006": words("Jump Squat"),
        }
        signals = {
            "0001": {"title": 1.0},
            "0002": {"visual": .99, "optical_flow": .99, "pose": .99, "joint_motion": .99},
            "0003": {"title": .75},
            "0004": {"title": .74},
            "0005": {"optical_flow": .8},
            "0006": {"visual": .65},
        }
        ordered = order_candidates(signals, words("Dumbbell Squat"), r2)
        self.assertEqual(ordered[0]["id"], "0001")
        self.assertEqual(len(set(x["id"] for x in ordered)), 6)

    def test_top_five_include_nonlexical_visual_alternative(self):
        gh = words("Standing Triceps Extension")
        titles = {
            "0001": words("Standing Triceps Extension"),
            "0002": words("Cable Triceps Extension"),
            "0003": words("Dumbbell Triceps Extension"),
            "0004": words("Band Triceps Extension"),
            "0005": words("Overhead Triceps Extension"),
            "0006": words("Seated Triceps Extension"),
            "0007": words("Lever Side Bend"),
        }
        scores = {key: {"title": 1 - i * .05}
                  for i, key in enumerate(titles)}
        scores["0007"]["visual"] = .95
        scores["0007"]["optical_flow"] = .9
        ranked = order_candidates(scores, gh, titles)
        top_five = [x["id"] for x in ranked[:5]]
        self.assertEqual(top_five[0], "0001")
        self.assertIn("0007", top_five)


if __name__ == "__main__":
    unittest.main()
