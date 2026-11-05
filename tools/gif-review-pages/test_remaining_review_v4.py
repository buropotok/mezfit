"""Human-review contracts for visually ordered unmatched GIFs.

Synthetic evidence fixtures do not redefine existing human-reviewed labels.
"""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from build_data import title_score, words
from remaining_review_v4 import build_remaining_review


class RemainingReviewTests(unittest.TestCase):
    def test_fused_visual_first_pose_fallback_and_metadata_only_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audit = root / "audit"
            audit.mkdir()
            exercises = root / "exercises" / "leg"
            exercises.mkdir(parents=True)
            gh = {
                "confirmed.gif": "Dumbbell Lunge",
                "visual.gif": "Bodyweight Sumo Squat",
                "pose.gif": "Bodyweight Sumo Squat",
                "metadata.gif": "Bodyweight Sumo Squat",
                "unknown.gif": "Unrecognized Exercise",
            }
            for gif in ("visual.gif", "pose.gif", "metadata.gif"):
                (exercises / (gif + ".json")).write_text(json.dumps({
                    "image_id": gif,
                    "name": "Bodyweight Sumo Squat",
                    "how_to": "Stand with feet wide and lower hips by bending the knees.",
                    "equipment": ["NO EQUIPMENT"],
                    "muscles": {"target": ["Quadriceps"]},
                }), encoding="utf-8")

            r2 = {
                "0001": {
                    "name": "Smith Sumo Squat",
                    "equipment": "smith machine",
                    "instructions_en": "A smith machine squat",
                    "muscles": {"primary": ["quadriceps"]}
                },
                "0002": {
                    "name": "Bodyweight Sumo Squat",
                    "equipment": "body weight",
                    "instructions_en": "Stand with feet wide and bend the knees.",
                    "muscles": {"primary": ["quadriceps"]}
                },
                "0003": {
                    "name": "Squat with Barbell",
                    "equipment": "barbell",
                    "instructions_en": "Squat with a heavy barbell",
                    "muscles": {"primary": ["quadriceps"]}
                },
            }
            self._csv(audit / "review.csv",
                      ["github_gif", "r2_gif", "score"], [
                          ["visual.gif", "0003.gif", "0.82"],
                          ["visual.gif", "0001.gif", "0.91"],
                      ])
            self._csv(audit / "pose-candidates.csv",
                      ["github_gif", "r2_gif", "pose_score"], [
                          ["visual.gif", "0002.gif", "0.99"],
                          ["pose.gif", "0001.gif", "0.94"],
                          ["pose.gif", "0002.gif", "0.88"],
                      ])
            result = build_remaining_review(
                audit, gh, r2, root / "exercises",
                words, title_score, {"confirmed.gif"}, expected_count=4
            )
            self.assertEqual(set(result), set(gh) - {"confirmed.gif"})

            visual = result["visual.gif"]
            self.assertEqual(visual["priority"], {
                "tier": 0, "score": 0.91, "channel": "appearance_motion"
            })
            self.assertEqual(visual["candidates"][0]["id"], "0001")
            self.assertEqual(visual["candidates"][0]["source"], "visual_review")
            self.assertTrue(visual["candidates"][0]["metadata_warnings"])
            self.assertEqual([c["id"] for c in visual["candidates"][1:]], ["0002"])
            self.assertEqual(visual["candidates"][1]["source"], "semantic")

            pose = result["pose.gif"]
            self.assertEqual(pose["priority"], {
                "tier": 1, "score": 0.94, "channel": "pose_position"
            })
            self.assertEqual(pose["candidates"][0]["id"], "0001")
            self.assertEqual(pose["candidates"][0]["source"], "pose_position")
            self.assertEqual(pose["candidates"][1]["id"], "0002")

            metadata = result["metadata.gif"]
            self.assertEqual(metadata["priority"], {
                "tier": 2, "score": None, "channel": "none"
            })
            self.assertEqual(metadata["candidates"][0]["id"], "0002")
            self.assertEqual(metadata["candidates"][0]["source"], "semantic")
            self.assertEqual(result["unknown.gif"]["priority"]["tier"], 2)
            self.assertTrue(all(len(item["candidates"]) <= 5
                                for item in result.values()))

    def test_rejects_malformed_audit_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exercises").mkdir()
            self._csv(root / "review.csv", ["github_gif", "r2_gif", "score"], [
                ["sample.gif", "0001.gif", "nan"],
            ])
            self._csv(root / "pose-candidates.csv", [
                "github_gif", "r2_gif", "pose_score"
            ], [])
            with self.assertRaises(ValueError):
                build_remaining_review(
                    root, {"sample.gif": "Squat"},
                    {"0001": {"name": "Squat", "equipment": "bodyweight"}},
                    root / "exercises", words, title_score, set(), expected_count=1
                )

    @staticmethod
    def _csv(path, headings, rows):
        with path.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerow(headings)
            writer.writerows(rows)


if __name__ == "__main__":
    unittest.main()
