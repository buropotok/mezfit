"""Deterministic, appearance-independent kinematics from MediaPipe landmarks.

A pose score is diagnostic evidence, never an identity probability. The sequence
matcher compares joint angles and their excursions under bounded cyclic DTW.
Missing joints are not interpreted as perfect agreement or a negative example.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from pose import PoseSignature

# left/right elbow, shoulder, hip and knee: indices in pose.JOINTS
ANGLES = (
    (0, 2, 4), (1, 3, 5),
    (2, 0, 6), (3, 1, 7),
    (0, 6, 8), (1, 7, 9),
    (6, 8, 10), (7, 9, 11),
)
MIRROR = (1, 0, 3, 2, 5, 4, 7, 6)
MIN_ANGLE_CHANNELS = 3
MIN_USABLE_FRAMES = 4


@dataclass(frozen=True)
class Kinematics:
    angles: np.ndarray  # (frames, 8) joint angle / pi
    valid: np.ndarray   # corresponding landmark confidence
    excursions: np.ndarray  # (8,) robust angular amplitude / pi

    @property
    def reliable(self) -> bool:
        frames = int(np.count_nonzero(self.valid.sum(axis=1) >= MIN_ANGLE_CHANNELS))
        return frames >= MIN_USABLE_FRAMES and bool(np.any(self.excursions >= 0.035))

    @property
    def vector(self) -> np.ndarray:
        """Phase-independent movement descriptor, *not* a similarity score."""
        if not self.reliable:
            return np.zeros(24, dtype=np.float32)
        means = np.zeros(8, dtype=np.float32)
        spreads = np.zeros(8, dtype=np.float32)
        for k in range(8):
            values = self.angles[self.valid[:, k], k]
            if len(values) >= MIN_USABLE_FRAMES:
                means[k] = float(np.mean(values)) - 0.5
                spreads[k] = float(np.std(values))
        raw = np.concatenate([means, 2 * spreads, 2 * self.excursions]).astype(np.float32)
        norm = float(np.linalg.norm(raw))
        return raw / norm if norm > 1e-6 else np.zeros_like(raw)


def extract(pose: PoseSignature) -> Kinematics:
    frames = pose.points.shape[0]
    angles = np.zeros((frames, len(ANGLES)), dtype=np.float32)
    valid = np.zeros_like(angles, dtype=bool)
    for k, (start, middle, end) in enumerate(ANGLES):
        ok = pose.visible[:, start] & pose.visible[:, middle] & pose.visible[:, end]
        first = pose.points[:, start] - pose.points[:, middle]
        second = pose.points[:, end] - pose.points[:, middle]
        lens = np.linalg.norm(first, axis=1) * np.linalg.norm(second, axis=1)
        ok &= lens > 1e-6
        with np.errstate(divide="ignore", invalid="ignore"):
            cosine = np.divide(np.sum(first * second, axis=1), lens,
                               out=np.zeros(frames, dtype=np.float32), where=lens > 1e-6)
        angles[ok, k] = np.arccos(np.clip(cosine[ok], -1, 1)) / np.pi
        valid[:, k] = ok
    excursion = np.zeros(len(ANGLES), dtype=np.float32)
    for k in range(len(ANGLES)):
        values = angles[valid[:, k], k]
        if len(values) >= MIN_USABLE_FRAMES:
            excursion[k] = float(np.percentile(values, 90) - np.percentile(values, 10))
    return Kinematics(angles=angles, valid=valid, excursions=excursion)


def _bounded_dtw(a: Kinematics, b: Kinematics, weights: np.ndarray,
                 radius: int) -> float | None:
    """Sakoe-Chiba constrained DTW; vectorize all joint-wise frame costs."""
    n, m = a.angles.shape[0], b.angles.shape[0]
    common = a.valid[:, None, :] & b.valid[None, :, :]
    counts = common.sum(axis=2)
    differences = np.abs(a.angles[:, None, :] - b.angles[None, :, :])
    joint_weights = weights[None, None, :] * common
    numerator = np.sum(differences * joint_weights, axis=2)
    denominator = np.maximum(np.sum(joint_weights, axis=2), 1e-6)
    local = np.where(
        counts >= MIN_ANGLE_CHANNELS,
        numerator / denominator + 0.08 * (len(ANGLES) - counts) / len(ANGLES),
        0.65,
    )
    cost = np.full((n + 1, m + 1), np.inf, dtype=np.float32)
    useful = np.zeros((n + 1, m + 1), dtype=np.int16)
    cost[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(max(1, i - radius), min(m, i + radius) + 1):
            previous = (
                (cost[i - 1, j - 1], useful[i - 1, j - 1]),
                (cost[i - 1, j] + 0.08, useful[i - 1, j]),
                (cost[i, j - 1] + 0.08, useful[i, j - 1]),
            )
            score, observed = min(previous, key=lambda state: state[0])
            cost[i, j] = score + local[i - 1, j - 1]
            useful[i, j] = observed + int(counts[i - 1, j - 1] >= MIN_ANGLE_CHANNELS)
    if not np.isfinite(cost[n, m]) or useful[n, m] < max(MIN_USABLE_FRAMES, n // 2):
        return None
    return float(cost[n, m] / max(n, m))



def similarity(left: Kinematics, right: Kinematics) -> float | None:
    if not left.reliable or not right.reliable:
        return None
    if left.angles.shape[0] != right.angles.shape[0]:
        raise ValueError("Joint-motion sequences require equal sample counts")
    n = left.angles.shape[0]
    radius = max(2, n // 4)
    best = None
    for mirrored in (False, True):
        b_values = right.angles[:, MIRROR] if mirrored else right.angles
        b_valid = right.valid[:, MIRROR] if mirrored else right.valid
        b_excursion = right.excursions[list(MIRROR)] if mirrored else right.excursions
        # Moving joints get more influence, including when they move in only
        # one animation. A static counterpart must not hide a different action.
        weights = 0.20 + np.minimum(1.0, np.maximum(left.excursions, b_excursion) / 0.25)
        strong = weights > 0.5
        covered = strong & (left.valid.sum(axis=0) >= MIN_USABLE_FRAMES) & (
            b_valid.sum(axis=0) >= MIN_USABLE_FRAMES)
        if not np.any(covered):
            continue
        amplitude_gap = float(np.sum(weights * np.abs(left.excursions - b_excursion)) /
                              max(np.sum(weights), 1e-6))
        for phase in range(n):
            shifted = Kinematics(angles=np.roll(b_values, phase, axis=0),
                                 valid=np.roll(b_valid, phase, axis=0),
                                 excursions=b_excursion)
            distance = _bounded_dtw(left, shifted, weights, radius)
            if distance is None:
                continue
            score = float(np.exp(-3.0 * (distance + 0.5 * amplitude_gap)))
            best = score if best is None else max(best, score)
    return best
