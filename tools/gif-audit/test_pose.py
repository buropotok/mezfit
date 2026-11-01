"""Behavioural tests for pose matching without requiring MediaPipe model downloads."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest

import numpy as np
from PIL import Image

import pose
import pose_diagnostics


def skeleton(frame: int = 0, *, offset: float = 0.0,
             scale: float = 1.0, different: bool = False):
    def xy(x: float, y: float):
        return ((x - 0.5) * scale + 0.5 + offset,
                (y - 0.5) * scale + 0.5 + offset)
    points = {
        11: (0.40, 0.35), 12: (0.60, 0.35),
        13: (0.34, 0.43), 14: (0.66, 0.43),
        15: (0.30 + 0.02 * frame, 0.51 if not different else 0.16),
        16: (0.70, 0.51),
        23: (0.43, 0.58), 24: (0.57, 0.58),
        25: (0.41, 0.76), 26: (0.59, 0.76),
        27: (0.40, 0.93), 28: (0.60, 0.93),
    }
    result = [SimpleNamespace(x=0.5, y=0.5, visibility=0.0, presence=0.0)
              for _ in range(33)]
    for i, (x, y) in points.items():
        xx, yy = xy(x, y)
        result[i] = SimpleNamespace(x=xx, y=yy, visibility=0.95, presence=0.95)
    return result


def mirrored(landmarks):
    result = [SimpleNamespace(x=0.5, y=0.5, visibility=0.0, presence=0.0)
              for _ in range(33)]
    for original, swapped in zip(pose.JOINTS, [12, 11, 14, 13, 16, 15,
                                             24, 23, 26, 25, 28, 27]):
        p = landmarks[original]
        result[swapped] = SimpleNamespace(x=1 - p.x, y=p.y,
                                           visibility=p.visibility, presence=p.presence)
    return result


class PoseTests(unittest.TestCase):
    def test_skeleton_shape_invariance_phase_shift_and_mirror(self):
        a = pose.from_landmarks([skeleton(i) for i in range(8)])
        b = pose.from_landmarks([skeleton((i + 3) % 8, scale=1.25, offset=0.03)
                                 for i in range(8)])
        c = pose.from_landmarks([mirrored(skeleton((i + 3) % 8))
                                 for i in range(8)])
        different = pose.from_landmarks([skeleton(i, different=True) for i in range(8)])
        self.assertTrue(a.reliable)
        self.assertEqual(a.vector.shape, (48,))
        self.assertGreater(pose.similarity(a, b), pose.similarity(a, different))
        self.assertGreater(pose.similarity(a, c), pose.similarity(a, different))

    def test_missing_predictions_are_not_fake_mismatches(self):
        good = pose.from_landmarks([skeleton(i) for i in range(8)])
        sparse = pose.from_landmarks([skeleton(0), skeleton(1)] + [None] * 6)
        self.assertFalse(sparse.reliable)
        self.assertIsNone(pose.similarity(good, sparse))
        self.assertEqual(sparse.detected_frames, 2)

    def test_low_visibility_core_landmarks_are_rejected(self):
        invalid = skeleton()
        invalid[11].visibility = 0.1
        sig = pose.from_landmarks([invalid] * 8)
        self.assertFalse(sig.reliable)

    def test_invalid_sample_count_fails(self):
        with self.assertRaises(ValueError):
            pose.from_landmarks([skeleton()] * 7)

    def test_sampled_rgb_frames_have_uniform_canvas(self):
        with TemporaryDirectory() as directory:
            name = Path(directory) / "test.gif"
            frames = [Image.new("RGB", (90, 140), ("white" if n % 2 else "black"))
                      for n in range(4)]
            frames[0].save(name, save_all=True, append_images=frames[1:],
                           duration=[20, 60, 90, 40], loop=0)
            sampled = pose.sampled_frames(name)
            self.assertEqual(len(sampled), 8)
            self.assertTrue(all(frame.shape == (320, 320, 3) for frame in sampled))
            self.assertTrue(all(frame.dtype == np.uint8 for frame in sampled))

    def test_owner_control_labels_are_diagnostic_only(self):
        rows = pose_diagnostics.read_controls()
        self.assertEqual(len(rows), 30)
        self.assertEqual(sum(r["decision"] == "yes" for r in rows), 15)


if __name__ == "__main__":
    unittest.main()
