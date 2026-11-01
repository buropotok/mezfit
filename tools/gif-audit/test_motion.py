"""Regression checks for the optical-flow channel.

These tests use synthetic GIF-like frames, not exercise titles or metadata.
"""
from __future__ import annotations

import unittest

import cv2
import numpy as np

import motion


def animation(*, horizontal: bool = True, circle: bool = False, phase: int = 0,
              watermark: bool = False) -> np.ndarray:
    frames = []
    for step in range(16):
        frame = np.full((64, 64), 255, dtype=np.uint8)
        position = ((step + phase) % 16) * 2 + 8
        x, y = (position, 32) if horizontal else (32, position)
        if circle:
            cv2.circle(frame, (x, y), 6, 25, thickness=-1)
        else:
            cv2.rectangle(frame, (x - 5, y - 10), (x + 5, y + 10), 25, thickness=-1)
        if watermark:
            cv2.putText(frame, "W", (1, 8), cv2.FONT_HERSHEY_PLAIN, 0.6, 0, 1)
        frames.append(frame)
    return np.stack(frames)


class MotionMatchingTests(unittest.TestCase):
    def test_motion_similarity_survives_static_watermark_and_phase_shift(self):
        original = motion.signature(animation())
        processed = motion.signature(animation(phase=5, watermark=True))
        score = motion.compare(original, processed)
        self.assertIsNotNone(score)
        self.assertGreater(score, 0.75)

    def test_different_model_rendering_remains_candidate_by_motion(self):
        rectangle = motion.signature(animation())
        circle = motion.signature(animation(circle=True))
        different_direction = motion.signature(animation(horizontal=False))
        same_movement = motion.compare(rectangle, circle)
        other_movement = motion.compare(rectangle, different_direction)
        self.assertIsNotNone(same_movement)
        self.assertIsNotNone(other_movement)
        self.assertGreater(same_movement, other_movement)

    def test_static_animations_are_not_motion_evidence(self):
        still = motion.signature(np.full((16, 64, 64), 255, dtype=np.uint8))
        active = motion.signature(animation())
        self.assertFalse(still.reliable)
        self.assertIsNone(motion.compare(still, active))

    def test_invalid_frames_are_rejected(self):
        with self.assertRaises(ValueError):
            motion.signature(np.zeros((2, 64, 64), dtype=np.uint8))


if __name__ == "__main__":
    unittest.main()
