#!/usr/bin/env python3
"""Read-only pose-evidence report; never changes the GIF matcher or its labels.

Run only with a separately verified, local MediaPipe model. The 30 human
decisions are reporting-only; similarity thresholds are not fitted to them.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from pose import PoseEstimator, PoseSignature, SWAPPED, similarity
from pose_motion import Kinematics, MIRROR, extract as joint_motion, similarity as compare_joint_motion

ROOT = Path(__file__).resolve().parents[2]
R2 = ROOT / "audit/gif-sources/r2"
GITHUB = ROOT / "assets/media"
REPORT = ROOT / "audit/gif-report"
LABELS = ROOT / "tools/gif-audit/control-30-reviewed.csv"
CANDIDATES = 8
OUTPUT_PER_GIF = 3


def read_controls() -> list[dict[str, str]]:
    with LABELS.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 30 or sum(r.get("decision") == "yes" for r in rows) != 15:
        raise ValueError("Expected exactly 30 manually classified pairs: 15 yes, 15 no")
    seen = set()
    for row in rows:
        if row.get("decision") not in ("yes", "no"):
            raise ValueError("Invalid human decision")
        key = (row["r2_gif"], row["github_gif"])
        if key in seen:
            raise ValueError(f"Duplicated human-reviewed pair: {key}")
        seen.add(key)
    return rows


def save_csv(target: Path, header: list[str], rows: list[list[object]]) -> None:
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def control_auc(rows: list[list[object]], column: int) -> float | None:
    """Pairwise ROC-AUC on *measurable* reviewed examples; diagnostic only."""
    positive = [float(row[column]) for row in rows
                if row[2] == "yes" and row[column] != ""]
    negative = [float(row[column]) for row in rows
                if row[2] == "no" and row[column] != ""]
    if not positive or not negative:
        return None
    wins = sum(
        1.0 if yes > no else 0.5 if yes == no else 0.0
        for yes in positive for no in negative
    )
    return wins / (len(positive) * len(negative))


def collect(estimator: PoseEstimator, paths: list[Path]) -> dict[str, PoseSignature]:
    results = {}
    for index, path in enumerate(paths, 1):
        if not path.is_file():
            raise FileNotFoundError(f"Missing GIF: {path}")
        results[path.name] = estimator.extract(path)
        if index % 50 == 0:
            print(f"MediaPipe: processed {index}/{len(paths)} GIFs from {path.parent}", flush=True)
    return results


def retrieve_all(
    r2: dict[str, PoseSignature], github: dict[str, PoseSignature],
    left_motion: dict[str, Kinematics], right_motion: dict[str, Kinematics],
    labels: list[dict[str, str]], out: Path,
) -> tuple[int, int, str]:
    """Union both independent retrieval channels, without auto-confirmation."""
    left, right = sorted(r2), sorted(github)
    names_a = {name: i for i, name in enumerate(left)}
    names_b = {name: j for j, name in enumerate(right)}
    position_a = np.stack([r2[name].vector for name in left])
    position_b = np.stack([github[name].vector for name in right])
    motion_a = np.stack([left_motion[name].vector for name in left])
    motion_b = np.stack([right_motion[name].vector for name in right])
    # Mirror-invariant candidate retrieval: matching left/right movements
    # must not depend on whether the athlete was drawn facing the other way.
    mirrored_position_b = np.stack([
        PoseSignature(
            points=github[name].points[:, SWAPPED, :] * np.array([-1, 1], dtype=np.float32),
            visible=github[name].visible[:, SWAPPED],
        ).vector for name in right
    ])
    mirrored_motion_b = np.stack([
        right_motion[name].vector.reshape(3, 8)[:, list(MIRROR)].reshape(-1)
        for name in right
    ])
    channels = {
        "pose_position": (
            np.maximum(position_a @ position_b.T,
                       position_a @ mirrored_position_b.T),
            np.array([r2[name].reliable for name in left]),
            np.array([github[name].reliable for name in right]),
        ),
        "joint_motion": (
            np.maximum(motion_a @ motion_b.T, motion_a @ mirrored_motion_b.T),
            np.array([left_motion[name].reliable for name in left]),
            np.array([right_motion[name].reliable for name in right]),
        ),
    }
    pairs: dict[tuple[int, int], set[str]] = {}
    ranks: dict[str, dict[int, list[int]]] = {}
    for channel, (coarse, good_left, good_right) in channels.items():
        coarse[~good_left, :] = -np.inf
        coarse[:, ~good_right] = -np.inf
        ranks[channel] = {}
        for i in range(len(left)):
            if not good_left[i]:
                continue
            order = [
                int(j) for j in np.argsort(coarse[i])[::-1]
                if np.isfinite(coarse[i, j])
            ][:20]
            ranks[channel][i] = order
            for j in order[:CANDIDATES]:
                pairs.setdefault((i, j), set()).add(channel)
        for j in range(len(right)):
            if not good_right[j]:
                continue
            order = np.argsort(coarse[:, j])[-CANDIDATES:]
            for i in order:
                if np.isfinite(coarse[i, j]):
                    pairs.setdefault((int(i), j), set()).add(channel)

    # Run the relatively expensive temporal comparison only on shortlist pairs.
    rows = []
    for index, ((i, j), origins) in enumerate(sorted(pairs.items()), 1):
        position_score = similarity(r2[left[i]], github[right[j]])
        movement_score = compare_joint_motion(left_motion[left[i]], right_motion[right[j]])
        rows.append((i, j, origins, position_score, movement_score))
        if index % 1000 == 0:
            print(f"Pose: ranked {index}/{len(pairs)} cross-library candidates", flush=True)

    output = []
    # Each channel retains its own ranking in each direction. A weak position
    # score cannot suppress a promising kinematic candidate, and vice versa.
    for channel in ("pose_position", "joint_motion"):
        for direction in ("R2", "GitHub"):
            groups: dict[int, list[tuple[float, tuple]]] = {}
            for row in rows:
                i, j, _, position_score, movement_score = row
                score = position_score if channel == "pose_position" else movement_score
                if score is None:
                    continue
                index = i if direction == "R2" else j
                groups.setdefault(index, []).append((score, row))
            for group in groups.values():
                for _, (i, j, origins, pos_score, motion_score) in sorted(
                    group, key=lambda value: (-value[0], left[value[1][0]], right[value[1][1]])
                )[:OUTPUT_PER_GIF]:
                    output.append([
                        direction, channel, left[i], right[j],
                        ",".join(sorted(origins)),
                        "" if pos_score is None else f"{pos_score:.5f}",
                        "" if motion_score is None else f"{motion_score:.5f}",
                    ])
    save_csv(out / "pose-candidates.csv",
             ["retrieval_direction", "ranked_by", "r2_gif", "github_gif",
              "retrieved_by", "pose_score", "joint_motion_score"], output)

    positives = [row for row in labels if row["decision"] == "yes"]
    details = []
    for channel in ("pose_position", "joint_motion"):
        for k in (5, 10, 20):
            observed = 0
            hits = 0
            for row in positives:
                i, j = names_a[row["r2_gif"]], names_b[row["github_gif"]]
                if i in ranks[channel]:
                    observed += 1
                    hits += int(j in ranks[channel][i][:k])
            details.append(f"{channel} positive recall@{k} (R2→GitHub): {hits}/{observed} measurable")
    union_retrieved = sum(
        (names_a[row["r2_gif"]], names_b[row["github_gif"]]) in pairs
        for row in positives
    )
    details.insert(0, f"Human-positive pairs in independent combined shortlist: {union_retrieved}/{len(positives)}")
    return len(pairs), len(output), "\n".join(f"- {line}" for line in details)



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--scope", choices=("controls", "all"), default="controls")
    parser.add_argument("--out", type=Path, default=REPORT)
    args = parser.parse_args()
    labels = read_controls()

    if args.scope == "controls":
        names_r2 = sorted({row["r2_gif"] for row in labels})
        names_gh = sorted({row["github_gif"] for row in labels})
        source_a = [R2 / name for name in names_r2]
        source_b = [GITHUB / name for name in names_gh]
    else:
        source_a = sorted(R2.glob("*.gif"))
        source_b = sorted(GITHUB.glob("*.gif"))
        if len(source_a) != 1324 or len(source_b) != 1168:
            raise ValueError("Full pose audit requires the same validated GIF inventories")
    args.out.mkdir(parents=True, exist_ok=True)
    with PoseEstimator(args.model) as estimator:
        left = collect(estimator, source_a)
        right = collect(estimator, source_b)
    left_motion = {name: joint_motion(item) for name, item in left.items()}
    right_motion = {name: joint_motion(item) for name, item in right.items()}
    coverage = [
        [library, name, item.detected_frames, int(item.reliable)]
        for library, catalogue in (("R2", left), ("GitHub", right))
        for name, item in sorted(catalogue.items())
    ]
    save_csv(args.out / "pose-coverage.csv",
             ["library", "gif", "detected_frames_of_16", "reliable"], coverage)
    evaluation = []
    for row in labels:
        a, b = left[row["r2_gif"]], right[row["github_gif"]]
        score = similarity(a, b)
        kinematic = compare_joint_motion(
            left_motion[row["r2_gif"]], right_motion[row["github_gif"]]
        )
        evaluation.append([
            row["r2_gif"], row["github_gif"], row["decision"],
            a.detected_frames, b.detected_frames,
            "" if score is None else f"{score:.5f}",
            "" if kinematic is None else f"{kinematic:.5f}",
        ])
    save_csv(args.out / "pose-control-30.csv",
             ["r2_gif", "github_gif", "human_decision", "r2_detected_frames",
              "github_detected_frames", "pose_score", "joint_motion_score"], evaluation)
    reliable_a = sum(s.reliable for s in left.values())
    reliable_b = sum(s.reliable for s in right.values())
    measurable_positive = sum(r[5] != "" for r in evaluation if r[2] == "yes")
    measurable_negative = sum(r[5] != "" for r in evaluation if r[2] == "no")
    motion_positive = sum(r[6] != "" for r in evaluation if r[2] == "yes")
    motion_negative = sum(r[6] != "" for r in evaluation if r[2] == "no")
    summary_lines = [
        "",
        "## MediaPipe Pose Landmarker diagnostics",
        "",
        f"- Scope: {args.scope} (no changes to automatic matches or delta).",
        f"- R2 reliable skeletons: {reliable_a}/{len(left)} GIFs.",
        f"- GitHub reliable skeletons: {reliable_b}/{len(right)} GIFs.",
        f"- Human-positive pairs with a pose score: {measurable_positive}/15.",
        f"- Human-negative pairs with a pose score: {measurable_negative}/15.",
        f"- Human-positive pairs with usable joint motion: {motion_positive}/15.",
        f"- Human-negative pairs with usable joint motion: {motion_negative}/15.",
        f"- Static-pose control ROC-AUC: {control_auc(evaluation, 5)} (measurable subset).",
        f"- Joint-motion control ROC-AUC: {control_auc(evaluation, 6)} (measurable subset).",
        "- Both ROC-AUC numbers are diagnostic: 30 nonrandom reviewed pairs, NOT population estimates.",
        "- Pose and joint-motion similarities are experimental, not match probabilities.",
        "- Missing skeletons never count as evidence of mismatch.",
        "- Controls are evaluated, never used for tuning or ranking.",
    ]
    if args.scope == "all":
        total_pairs, ranked, retrieval = retrieve_all(
            left, right, left_motion, right_motion, labels, args.out
        )
        summary_lines.append(
            f"- Independent pose/kinematics retrieval: {total_pairs} candidate pairs, {ranked} ranked rows."
        )
        summary_lines.append(retrieval)
        summary_lines.append("- See pose-candidates.csv (review only, not confirmed).")
    summary_lines.append("- See pose-coverage.csv and pose-control-30.csv.")
    summary = "\n".join(summary_lines) + "\n"
    with (args.out / "summary.md").open("a", encoding="utf-8") as target:
        target.write(summary)
    print(summary, flush=True)


if __name__ == "__main__":
    main()
