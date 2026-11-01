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

from pose import PoseEstimator, PoseSignature, similarity

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
    out: Path,
) -> tuple[int, int]:
    """Independent pose-only retrieval: do not inject unverified pairs into auto matches."""
    left = sorted(r2)
    right = sorted(github)
    va = np.stack([r2[name].vector for name in left])
    vb = np.stack([github[name].vector for name in right])
    coarse = va @ vb.T
    good_left = np.array([r2[name].reliable for name in left])
    good_right = np.array([github[name].reliable for name in right])
    coarse[~good_left, :] = -np.inf
    coarse[:, ~good_right] = -np.inf
    pairs: set[tuple[int, int]] = set()
    for i in range(len(left)):
        if good_left[i]:
            for j in np.argsort(coarse[i])[-CANDIDATES:]:
                if np.isfinite(coarse[i, j]):
                    pairs.add((i, int(j)))
    for j in range(len(right)):
        if good_right[j]:
            for i in np.argsort(coarse[:, j])[-CANDIDATES:]:
                if np.isfinite(coarse[i, j]):
                    pairs.add((int(i), j))

    per_left: dict[int, list[tuple[float, int]]] = {}
    per_right: dict[int, list[tuple[float, int]]] = {}
    for index, (i, j) in enumerate(sorted(pairs), 1):
        score = similarity(r2[left[i]], github[right[j]])
        if score is not None:
            per_left.setdefault(i, []).append((score, j))
            per_right.setdefault(j, []).append((score, i))
        if index % 1000 == 0:
            print(f"MediaPipe: ranked {index}/{len(pairs)} pose candidates", flush=True)
    # Preserve direction to avoid presenting one candidate as a confirmed 1:1.
    output = []
    for i, values in per_left.items():
        for score, j in sorted(values, reverse=True)[:OUTPUT_PER_GIF]:
            output.append(["R2", left[i], right[j], f"{score:.5f}"])
    for j, values in per_right.items():
        for score, i in sorted(values, reverse=True)[:OUTPUT_PER_GIF]:
            output.append(["GitHub", left[i], right[j], f"{score:.5f}"])
    save_csv(out / "pose-candidates.csv",
             ["retrieval_direction", "r2_gif", "github_gif", "pose_score"], output)
    return len(pairs), len(output)


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
    coverage = [
        [library, name, item.detected_frames, int(item.reliable)]
        for library, catalogue in (("R2", left), ("GitHub", right))
        for name, item in sorted(catalogue.items())
    ]
    save_csv(args.out / "pose-coverage.csv",
             ["library", "gif", "detected_frames_of_8", "reliable"], coverage)
    evaluation = []
    for row in labels:
        a, b = left[row["r2_gif"]], right[row["github_gif"]]
        score = similarity(a, b)
        evaluation.append([
            row["r2_gif"], row["github_gif"], row["decision"],
            a.detected_frames, b.detected_frames,
            "" if score is None else f"{score:.5f}",
        ])
    save_csv(args.out / "pose-control-30.csv",
             ["r2_gif", "github_gif", "human_decision", "r2_detected_frames",
              "github_detected_frames", "pose_score"], evaluation)
    reliable_a = sum(s.reliable for s in left.values())
    reliable_b = sum(s.reliable for s in right.values())
    measurable_positive = sum(r[5] != "" for r in evaluation if r[2] == "yes")
    measurable_negative = sum(r[5] != "" for r in evaluation if r[2] == "no")
    summary_lines = [
        "",
        "## MediaPipe Pose Landmarker diagnostics",
        "",
        f"- Scope: {args.scope} (no changes to automatic matches or delta).",
        f"- R2 reliable skeletons: {reliable_a}/{len(left)} GIFs.",
        f"- GitHub reliable skeletons: {reliable_b}/{len(right)} GIFs.",
        f"- Human-positive pairs with a pose score: {measurable_positive}/15.",
        f"- Human-negative pairs with a pose score: {measurable_negative}/15.",
        "- Pose similarity is experimental, not a match probability.",
        "- Missing skeletons never count as evidence of mismatch.",
        "- Controls are evaluated, never used for tuning or ranking.",
    ]
    if args.scope == "all":
        total_pairs, ranked = retrieve_all(left, right, args.out)
        summary_lines.append(
            f"- Independent pose retrieval: {total_pairs} candidate pairs, {ranked} ranked rows."
        )
        summary_lines.append("- See pose-candidates.csv (review only, not confirmed).")
    summary_lines.append("- See pose-coverage.csv and pose-control-30.csv.")
    summary = "\n".join(summary_lines) + "\n"
    with (args.out / "summary.md").open("a", encoding="utf-8") as target:
        target.write(summary)
    print(summary, flush=True)


if __name__ == "__main__":
    main()
