"""Optional, independent MediaPipe pose evidence for GIF visual audits.

This module never reads exercise IDs/titles and never changes automated matches.
MediaPipe is imported lazily so the standard audit and its tests stay lightweight.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SAMPLE_COUNT = 8
AUDIT_SAMPLE_COUNT = 16
CANVAS = 320
# Left/right shoulders, elbows, wrists, hips, knees and ankles.
JOINTS = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
MIN_VISIBILITY = 0.40
MIN_VALID_JOINTS = 6
MIN_VALID_FRAMES = 4
# MediaPipe left/right landmark indices within JOINTS.
SWAPPED = (1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10)


@dataclass(frozen=True)
class PoseSignature:
    points: np.ndarray   # (frames, 12, 2) normalized to torso length
    visible: np.ndarray  # (frames, 12) boolean, missing joints never filled as facts

    @property
    def detected_frames(self) -> int:
        return int(np.count_nonzero(np.sum(self.visible, axis=1) >= MIN_VALID_JOINTS))

    @property
    def reliable(self) -> bool:
        return self.detected_frames >= MIN_VALID_FRAMES

    @property
    def vector(self) -> np.ndarray:
        """Mean and temporal spread, for independent appearance-free retrieval."""
        if not self.reliable:
            return np.zeros(48, dtype=np.float32)
        mask = self.visible[:, :, None].astype(np.float32)
        count = np.maximum(np.sum(mask, axis=0), 1)
        mean = np.sum(self.points * mask, axis=0) / count
        variance = np.sum(((self.points - mean) * mask) ** 2, axis=0) / count
        spread = np.sqrt(variance)
        result = np.concatenate([mean.flatten(), spread.flatten()]).astype(np.float32)
        norm = float(np.linalg.norm(result))
        return result / norm if norm > 1e-6 else np.zeros_like(result)


def from_landmarks(frames: list[list[object] | None]) -> PoseSignature:
    """Normalize x/y coordinates without assuming a particular gender/body size."""
    if len(frames) not in (SAMPLE_COUNT, AUDIT_SAMPLE_COUNT):
        raise ValueError(f"Expected {SAMPLE_COUNT} or {AUDIT_SAMPLE_COUNT} sampled frames")
    points = np.zeros((len(frames), len(JOINTS), 2), dtype=np.float32)
    visible = np.zeros((len(frames), len(JOINTS)), dtype=bool)
    for frame_index, landmarks in enumerate(frames):
        if not landmarks or len(landmarks) < 33:
            continue
        confidence = np.array([
            min(float(getattr(landmarks[i], "visibility", 0.0)),
                float(getattr(landmarks[i], "presence", 1.0)))
            for i in JOINTS
        ], dtype=np.float32)
        valid = confidence >= MIN_VISIBILITY
        # Reliable shoulders and hips anchor a consistent torso coordinate frame.
        if not all(valid[i] for i in (0, 1, 6, 7)):
            continue
        if int(np.count_nonzero(valid)) < MIN_VALID_JOINTS:
            continue
        center_shoulders = np.mean([
            [landmarks[i].x, landmarks[i].y] for i in (11, 12)
        ], axis=0)
        center_hips = np.mean([
            [landmarks[i].x, landmarks[i].y] for i in (23, 24)
        ], axis=0)
        torso = float(np.linalg.norm(center_shoulders - center_hips))
        if not 0.045 <= torso <= 1.0:
            continue
        coords = np.array([
            [float(landmarks[i].x), float(landmarks[i].y)] for i in JOINTS
        ], dtype=np.float32)
        if not np.all(np.isfinite(coords)):
            continue
        points[frame_index] = np.clip((coords - center_hips) / torso, -5, 5)
        visible[frame_index] = valid
    return PoseSignature(points=points, visible=visible)


def similarity(a: PoseSignature, b: PoseSignature) -> float | None:
    """Cyclic pose sequence similarity, allowing left-right mirror and phase shift.

    A missing/low-confidence model prediction is *not* negative evidence.
    This number is an uncalibrated ranking score, NOT a match probability.
    """
    if not a.reliable or not b.reliable:
        return None
    best: float | None = None
    if a.points.shape[0] != b.points.shape[0]:
        raise ValueError("Pose sequences must use equal sample counts")
    for mirror in (False, True):
        points_b = b.points[:, SWAPPED, :].copy() if mirror else b.points
        visible_b = b.visible[:, SWAPPED] if mirror else b.visible
        if mirror:
            points_b[:, :, 0] *= -1
        for phase in range(a.points.shape[0]):
            frame_scores = []
            for index in range(a.points.shape[0]):
                other = (index + phase) % a.points.shape[0]
                common = a.visible[index] & visible_b[other]
                if np.count_nonzero(common) < MIN_VALID_JOINTS:
                    continue
                distances = np.linalg.norm(
                    a.points[index, common] - points_b[other, common], axis=1,
                )
                # Median alone can report a perfect match when a single
                # wrist or ankle takes a different path: most joints stay
                # identical and hide the meaningful local motion. The
                # clipped mean retains such differences while limiting
                # the effect of one badly located landmark.
                frame_scores.append(float(np.mean(np.clip(distances, 0, 2))))
            if len(frame_scores) < MIN_VALID_FRAMES:
                continue
            score = float(np.exp(-np.mean(frame_scores) / 0.85))
            best = score if best is None else max(best, score)
    return best


def sampled_frames(path: Path, sample_count: int = SAMPLE_COUNT) -> list[np.ndarray]:
    """Time-uniform composited RGB frames, scaled for pose detection."""
    if sample_count not in (SAMPLE_COUNT, AUDIT_SAMPLE_COUNT):
        raise ValueError("Unsupported pose sample count")
    result: list[np.ndarray] = []
    with Image.open(path) as gif:
        if gif.format != "GIF" or not 1 <= gif.n_frames <= 2000:
            raise ValueError(f"Invalid GIF file: {path}")
        durations = []
        for index in range(gif.n_frames):
            gif.seek(index)
            durations.append(max(20, min(int(gif.info.get("duration") or 100), 5000)))
        times = np.cumsum(durations)
        total = int(times[-1])
        for sample in range(sample_count):
            time_ms = (sample + 0.5) * total / sample_count
            chosen = min(gif.n_frames - 1, bisect_right(times, time_ms))
            gif.seek(chosen)
            rgb = np.asarray(gif.convert("RGB"))
            height, width = rgb.shape[:2]
            scale = min(CANVAS / height, CANVAS / width)
            resized = cv2.resize(
                rgb, (max(1, round(width * scale)), max(1, round(height * scale))),
                interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR,
            )
            canvas = np.full((CANVAS, CANVAS, 3), 255, dtype=np.uint8)
            y = (CANVAS - resized.shape[0]) // 2
            x = (CANVAS - resized.shape[1]) // 2
            canvas[y:y + resized.shape[0], x:x + resized.shape[1]] = resized
            result.append(np.ascontiguousarray(canvas))
    return result


class PoseEstimator:
    """Use Google's versioned Tasks API in single-image CPU mode."""
    def __init__(self, model: Path):
        if not model.is_file():
            raise FileNotFoundError(f"MediaPipe model not found: {model}")
        import mediapipe as mp  # optional dependency; no import in base CI
        self.mp = mp
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.40,
            min_pose_presence_confidence=0.40,
            output_segmentation_masks=False,
        )
        self.landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.landmarker.close()

    def extract(self, path: Path) -> PoseSignature:
        landmarks = []
        for rgb in sampled_frames(path, AUDIT_SAMPLE_COUNT):
            image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
            prediction = self.landmarker.detect(image)
            landmarks.append(prediction.pose_landmarks[0] if prediction.pose_landmarks else None)
        return from_landmarks(landmarks)
