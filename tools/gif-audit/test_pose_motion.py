"""Regression tests for deterministic angular trajectories and bounded DTW.

No model download, external media, API access or exercise names are needed.
"""
from __future__ import annotations

from math import pi, sin
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import csv
import unittest

import numpy as np

from pose import from_landmarks
from pose_motion import extract, similarity, _bounded_dtw
from pose_diagnostics import retrieve_all


def sequence(*, kind: str = "arm", phase: int = 0, scale: float = 1.0,
             offset: float = 0.0, missing: int = 0):
    result = []
    for frame in range(16):
        if frame < missing:
            result.append(None)
            continue
        step = (frame + phase) % 16
        motion = sin(2 * pi * step / 16)
        coords = {
            11: (0.40, 0.34), 12: (0.60, 0.34),
            13: (0.35, 0.44), 14: (0.65, 0.44),
            15: (0.31, 0.54), 16: (0.69, 0.54),
            23: (0.43, 0.59), 24: (0.57, 0.59),
            25: (0.43, 0.77), 26: (0.57, 0.77),
            27: (0.43, 0.94), 28: (0.57, 0.94),
        }
        if kind == "arm":
            coords[15] = (0.31 + 0.11 * motion, 0.54 - 0.11 * motion)
        elif kind == "leg":
            coords[25] = (0.43 + 0.11 * motion, 0.77 - 0.09 * motion)
            coords[27] = (0.43 + 0.18 * motion, 0.94 - 0.04 * motion)
        elif kind != "static":
            raise ValueError(kind)
        data = [SimpleNamespace(x=0.5, y=0.5, visibility=0, presence=0)
                for _ in range(33)]
        for key, (x, y) in coords.items():
            data[key] = SimpleNamespace(
                x=(x - 0.5) * scale + 0.5 + offset,
                y=(y - 0.5) * scale + 0.5 + offset,
                visibility=0.95, presence=0.95,
            )
        result.append(data)
    return from_landmarks(result)


class JointMotionTests(unittest.TestCase):
    def test_extracted_angles_are_finite_and_normalized(self):
        item = extract(sequence())
        self.assertTrue(item.reliable)
        self.assertEqual(item.vector.shape, (24,))
        self.assertTrue(np.isfinite(item.vector).all())
        self.assertTrue(np.all(item.angles[item.valid] <= 1))
        self.assertTrue(np.all(item.angles[item.valid] >= 0))

    def test_scale_and_playback_phase_do_not_override_movement(self):
        same = extract(sequence(kind="arm"))
        shifted = extract(sequence(kind="arm", scale=1.2, offset=0.03, phase=4))
        different = extract(sequence(kind="leg"))
        identical_score = similarity(same, shifted)
        other_score = similarity(same, different)
        self.assertIsNotNone(identical_score)
        self.assertIsNotNone(other_score)
        self.assertGreater(identical_score, other_score)

    def test_static_clip_provides_no_motion_evidence(self):
        static = extract(sequence(kind="static"))
        active = extract(sequence(kind="arm"))
        self.assertFalse(static.reliable)
        self.assertIsNone(similarity(static, active))

    def test_low_coverage_is_not_false_evidence(self):
        sparse = extract(sequence(kind="arm", missing=13))
        regular = extract(sequence(kind="arm"))
        self.assertFalse(sparse.reliable)
        self.assertIsNone(similarity(regular, sparse))

    def test_bounded_alignment_rejects_missing_joint_intersections(self):
        a = extract(sequence(kind="arm"))
        b = extract(sequence(kind="arm"))
        b.valid[:] = False
        weights = np.ones(8, dtype=np.float32)
        self.assertIsNone(_bounded_dtw(a, b, weights, radius=4))

    def test_independent_retrieval_keeps_correct_pairs_in_shortlist(self):
        left = {"a.gif": sequence(kind="arm"), "b.gif": sequence(kind="leg")}
        right = {
            "c.gif": sequence(kind="arm", phase=4, scale=1.2),
            "d.gif": sequence(kind="leg", phase=3),
        }
        left_angles = {name: extract(sig) for name, sig in left.items()}
        right_angles = {name: extract(sig) for name, sig in right.items()}
        labels = [{"r2_gif": "a.gif", "github_gif": "c.gif", "decision": "yes"}]
        with TemporaryDirectory() as folder:
            total, ranked, metrics = retrieve_all(
                left, right, left_angles, right_angles, labels, Path(folder),
            )
            with (Path(folder) / "pose-candidates.csv").open(newline="") as handle:
                rows = list(csv.DictReader(handle))
        self.assertGreater(total, 0)
        self.assertGreater(ranked, 0)
        self.assertIn("1/1", metrics)
        self.assertIn(("a.gif", "c.gif"),
                      {(row["r2_gif"], row["github_gif"]) for row in rows})
        self.assertTrue(all(row["ranked_by"] in ("pose_position", "joint_motion")
                            for row in rows))

    def test_mismatched_sequence_length_is_rejected(self):
        a = extract(sequence(kind="arm"))
        shorter = extract(from_landmarks(sequence_landmarks_8()))
        self.assertTrue(shorter.reliable)
        with self.assertRaises(ValueError):
            similarity(a, shorter)


def sequence_landmarks_8():
    frames = []
    for i in range(8):
        step = sin(2 * pi * i / 8)
        coords = {
            11: (0.40, 0.34), 12: (0.60, 0.34),
            13: (0.35, 0.44), 14: (0.65, 0.44),
            15: (0.31 + 0.11 * step, 0.54 - 0.11 * step), 16: (0.69, 0.54),
            23: (0.43, 0.59), 24: (0.57, 0.59),
            25: (0.43, 0.77), 26: (0.57, 0.77),
            27: (0.43, 0.94), 28: (0.57, 0.94),
        }
        data = [SimpleNamespace(x=0.5, y=0.5, visibility=0, presence=0)
                for _ in range(33)]
        for key, (x, y) in coords.items():
            data[key] = SimpleNamespace(x=x, y=y, visibility=0.95, presence=0.95)
        frames.append(data)
    return frames


if __name__ == "__main__":
    unittest.main()
