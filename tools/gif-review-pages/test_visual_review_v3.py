"""Contracts for the human-only 419 visual shortlist (no model training or auto-accept)."""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from build_data import title_score, words
from visual_review_v3 import build_visual_review, equipment_tags


class VisualQueueTests(unittest.TestCase):
    def test_normalizes_explicit_no_equipment_before_full_gym(self):
        self.assertEqual(equipment_tags(["Full Gym", "NO EQUIPMENT"]), {"bodyweight"})
        self.assertEqual(equipment_tags("body weight"), {"bodyweight"})
        self.assertEqual(equipment_tags("smith machine"), {"smith"})
        self.assertEqual(equipment_tags("barbell"), {"barbell"})

    def test_419_visual_pairs_stay_first_even_with_metadata_conflicts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audit = root / "audit"
            audit.mkdir()
            exercises = root / "exercises" / "leg"
            exercises.mkdir(parents=True)
            gifs = ["Bodyweight-Sumo-Squat-%03d.gif" % n for n in range(419)]
            source = {
                "name": "Bodyweight Sumo Squat",
                "image_id": gifs[0],
                "equipment": ["Full Gym", "NO EQUIPMENT"],
                "how_to": "Stand with feet wide and toes outward. Bend knees and lower the hips.",
                "muscles": {"target": ["Quadriceps"]}
            }
            (exercises / "bodyweight-sumo-squat.json").write_text(
                json.dumps(source), encoding="utf-8"
            )
            r2 = {
                ("%04d" % (n + 1)): {
                    "name": "Smith Sumo Squat", "equipment": "smith machine",
                    "instructions_en": "Use the smith machine to lower into a sumo squat.",
                    "muscles": {"primary": ["quadriceps"]}, "target": "quadriceps"
                }
                for n in range(419)
            }
            for n in range(4):
                r2["%04d" % (500 + n)] = {
                    "name": "Bodyweight Sumo Squat", "equipment": "body weight",
                    "instructions_en": "Stand with feet wide and toes outward. "
                                       "Bend knees and lower the hips.",
                    "muscles": {"primary": ["quadriceps"]}, "target": "quadriceps"
                }
            with (audit / "matches.csv").open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=[
                    "r2_gif", "github_gif", "score", "appearance_score", "motion_score"
                ])
                writer.writeheader()
                for n, gif in enumerate(gifs):
                    writer.writerow({
                        "r2_gif": "%04d.gif" % (n + 1), "github_gif": gif,
                        "score": "0.91", "appearance_score": "0.98",
                        "motion_score": "0.75"
                    })
            result = build_visual_review(
                audit, {gif: "Bodyweight Sumo Squat" for gif in gifs}, r2,
                root / "exercises", words, title_score
            )
            self.assertEqual(len(result), 419)
            first = result[gifs[0]]
            self.assertEqual(first[0]["id"], "0001")
            self.assertEqual(first[0]["source"], "visual_audit")
            self.assertTrue(first[0]["metadata_warnings"])
            self.assertEqual(first[0]["source_equipment"], "bodyweight")
            self.assertEqual(len(first), 5)
            self.assertEqual({c["id"] for c in first[1:]},
                             {"0500", "0501", "0502", "0503"})
            self.assertTrue(all(c["source"] == "semantic" for c in first[1:]))
            self.assertTrue(all(c["equipment"] == "body weight" for c in first[1:]))

    def test_full_gym_is_not_compatible_apparatus(self):
        self.assertFalse(equipment_tags("Full Gym"))
        self.assertNotEqual(equipment_tags("smith machine"), equipment_tags("no equipment"))


if __name__ == "__main__":
    unittest.main()
