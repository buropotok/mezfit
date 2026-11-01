"""Regression tests for deterministic angular trajectories and bounded DTW.

No model download, external media, API access or exercise names are needed.
"""
from __future__ import annotations

from math import pi, sin
from types import SimpleNamespace
import unittest

import numpy as np

from pose import from_landmarks
from pose_motion import extract, similarity, _bounded_dtw


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
