"""Appearance-agnostic GIF motion signatures using dense optical flow.

No exercise IDs, filenames, gender labels, learned model or external services.
A weak / static motion signal is treated as unavailable, not as evidence of a match.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

GRID = 5
FLOW_SIZE = 64
MIN_MOTION = 0.004


@dataclass
class MotionSignature:
    # Frame-level descriptors keep the direction and spatial position of motion.
    steps: np.ndarray
    # Phase-invariant aggregate for independent cross-library candidate retrieval.
    vector: np.ndarray
    # Active area fraction after suppressing subpixel GIF noise.
    activity: float

    @property
    def reliable(self) -> bool:
        return self.activity >= MIN_MOTION


def _unit(vector: np.ndarray) -> np.ndarray:
    magnitude = float(np.linalg.norm(vector))
    return vector / magnitude if magnitude >= 1e-6 else np.zeros_like(vector)


def signature(frames: np.ndarray) -> MotionSignature:
    """Summarize a cyclic sequence of decoded, normalized grayscale frames.

    The descriptor uses *changes between frames*: logos, static backgrounds,
    and differences in model appearance do not directly contribute.
    """
    if frames.ndim != 3 or frames.shape[0] < 3:
        raise ValueError("Expected a stack of at least three grayscale frames")
    if frames.shape[1] != FLOW_SIZE or frames.shape[2] != FLOW_SIZE:
        sequence = np.stack([
            cv2.resize(frame, (FLOW_SIZE, FLOW_SIZE), interpolation=cv2.INTER_AREA)
            for frame in frames
        ])
    else:
        sequence = frames
    sequence = np.ascontiguousarray(sequence, dtype=np.uint8)
    signals: list[np.ndarray] = []
    activity: list[float] = []
    for index in range(len(sequence)):
        before = sequence[index]
        after = sequence[(index + 1) % len(sequence)]
        changed = cv2.absdiff(before, after)
        # Downweight dithering, compression noise and static printed watermarks.
        mask = (changed > 14).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        active = float(np.mean(mask))
        activity.append(active)
        if active <= 0.0001:
            signals.append(np.zeros(GRID * GRID * 3 + 8, dtype=np.float32))
            continue
        flow = cv2.calcOpticalFlowFarneback(
            before, after, None, 0.5, 2, 13, 2, 5, 1.1, 0,
        )
        flow = np.clip(flow, -8.0, 8.0)
        vx = flow[:, :, 0] * mask
        vy = flow[:, :, 1] * mask
        magnitude = np.sqrt(vx * vx + vy * vy)
        maximum = max(0.15, float(np.percentile(magnitude[mask > 0], 85)))
        # Per-GIF velocity normalization is intentionally amplitude-tolerant.
        vx = np.clip(vx / maximum, -1, 1)
        vy = np.clip(vy / maximum, -1, 1)
        mag = np.clip(magnitude / maximum, 0, 1)
        # Coarse spatial information resists small body-shape differences.
        coarse = [cv2.resize(value, (GRID, GRID), interpolation=cv2.INTER_AREA).ravel()
                  for value in (vx, vy, mag)]
        angles = np.arctan2(vy[mask > 0], vx[mask > 0])
        weights = mag[mask > 0]
        directions = np.histogram(angles, bins=8, range=(-np.pi, np.pi),
                                  weights=weights)[0].astype(np.float32)
        directions = _unit(directions)
        signals.append(np.concatenate([*coarse, directions]).astype(np.float32))
    raw = np.stack(signals)
    # Keep a normalized per-frame representation for cyclic alignment.
    steps = np.stack([_unit(item) for item in raw])
    aggregate = np.concatenate([
        np.mean(raw[:, :GRID * GRID * 3], axis=0),
        np.std(raw[:, :GRID * GRID * 3], axis=0),
        np.mean(raw[:, GRID * GRID * 3:], axis=0),
    ]).astype(np.float32)
    return MotionSignature(steps=steps, vector=_unit(aggregate),
                           activity=float(np.mean(activity)))


def compare(a: MotionSignature, b: MotionSignature) -> float | None:
    """Compare phase-shifted motion patterns, returning None if unreliable.

    A simple cyclic search avoids interpreting GIF playback start offset as
    a meaningful difference between the same movement.
    """
    if not a.reliable or not b.reliable:
        return None
    if a.steps.shape != b.steps.shape:
        raise ValueError("Motion sequences must use the same sampling count")
    # Negative cosine corresponds to reversed / opposing movement direction.
    similarities = [
        float(np.mean(np.sum(a.steps * np.roll(b.steps, shift, axis=0), axis=1)))
        for shift in range(len(a.steps))
    ]
    return float(np.clip((max(similarities) + 1.0) / 2.0, 0, 1))
