#!/usr/bin/env python3
"""Visual-only, one-to-one comparison of two unique GIF libraries."""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
import argparse
import csv
from html import escape
from pathlib import Path
from urllib.parse import quote

import cv2
import numpy as np
from PIL import Image
from scipy.optimize import linear_sum_assignment
from skimage.metrics import structural_similarity

from motion import MotionSignature, compare as compare_motion, signature as motion_signature

ROOT = Path(__file__).resolve().parents[2]
R2 = ROOT / "audit/gif-sources/r2"
GITHUB = ROOT / "assets/media"
DEFAULT_REPORT = ROOT / "audit/gif-report"
SAMPLES = 16
TOP_K = 24
EXACT_CANDIDATES = 8
MATCH_THRESHOLD = 0.86
REVIEW_THRESHOLD = 0.62
MATCH_MARGIN = 0.035
R2_BRANCH = "data/r2-gif-snapshot"


@dataclass
class Fingerprint:
    path: Path
    frames: np.ndarray
    hashes: tuple[int, ...]
    vector: np.ndarray
    n_frames: int
    duration_ms: int
    motion: MotionSignature


def normalized_frame(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape
    factor = min(64 / width, 64 / height)
    scaled = cv2.resize(gray, (max(1, round(width * factor)), max(1, round(height * factor))),
                        interpolation=cv2.INTER_AREA)
    canvas = np.full((64, 64), 255, dtype=np.uint8)
    y = (64 - scaled.shape[0]) // 2
    x = (64 - scaled.shape[1]) // 2
    canvas[y:y + scaled.shape[0], x:x + scaled.shape[1]] = scaled
    # Fixed corner marks are discarded identically in both source libraries.
    canvas[:9, :13] = 255
    canvas[:9, -13:] = 255
    canvas[-9:, :13] = 255
    canvas[-9:, -13:] = 255
    return canvas


def perceptual_hash(gray: np.ndarray) -> int:
    thumbnail = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    low = cv2.dct(thumbnail.astype(np.float32))[:8, :8].flatten()[1:]
    median = float(np.median(low))
    bits = low > median
    return sum(int(bit) << index for index, bit in enumerate(bits))


def fingerprint(path: Path) -> Fingerprint:
    with Image.open(path) as gif:
        if gif.format != "GIF" or gif.n_frames < 1 or gif.n_frames > 2000:
            raise ValueError(f"Invalid GIF frame count: {path}")
        durations = []
        for index in range(gif.n_frames):
            gif.seek(index)
            delay = int(gif.info.get("duration") or 100)
            durations.append(max(20, min(delay, 5000)))
        cumulative = np.cumsum(durations)
        total = int(cumulative[-1])
        targets = [(i + 0.5) * total / SAMPLES for i in range(SAMPLES)]
        chosen = [min(gif.n_frames - 1, bisect_right(cumulative, t)) for t in targets]
        # Pillow's GIF seek composites frames according to disposal/transparency.
        frames = []
        for index in chosen:
            gif.seek(index)
            frames.append(normalized_frame(gif))
        array = np.stack(frames)
        mean = array.mean(axis=0).astype(np.uint8)
        variation = array.std(axis=0)
        edges = np.stack([cv2.Canny(frame, 50, 140) for frame in array]).mean(axis=0)
        features = np.concatenate([
            cv2.resize(mean, (24, 24)).flatten() / 255,
            cv2.resize(variation.astype(np.float32), (24, 24)).flatten() / 128,
            cv2.resize(edges.astype(np.float32), (24, 24)).flatten() / 255,
        ]).astype(np.float32)
        features -= features.mean()
        features /= max(float(np.linalg.norm(features)), 1e-6)
        return Fingerprint(path, array, tuple(perceptual_hash(f) for f in array),
                           features, gif.n_frames, total, motion_signature(array))


def fingerprint_library(directory: Path, *, expected_count: int | None = None) -> list[Fingerprint]:
    paths = sorted(directory.glob("*.gif"))
    if not paths or (expected_count is not None and len(paths) != expected_count):
        raise ValueError(f"Unexpected GIF inventory at {directory}: {len(paths)}")
    results = []
    for number, path in enumerate(paths, 1):
        results.append(fingerprint(path))
        if number % 100 == 0:
            print(f"Fingerprinted {number}/{len(paths)}: {directory}", flush=True)
    return results


def best_phase(left: Fingerprint, right: Fingerprint) -> tuple[float, int]:
    best = (-1.0, 0)
    for offset in range(SAMPLES):
        similarity = 1 - sum((left.hashes[i] ^ right.hashes[(i + offset) % SAMPLES]).bit_count()
                             for i in range(SAMPLES)) / (SAMPLES * 63)
        if similarity > best[0]:
            best = (similarity, offset)
    return best


def align_frames(left: Fingerprint, right: Fingerprint, offset: int) -> list[tuple[int, int]]:
    """DTW allows different frame timing while keeping the cyclic phase offset."""
    distances = np.array([
        [(left.hashes[i] ^ right.hashes[(j + offset) % SAMPLES]).bit_count() / 63
         for j in range(SAMPLES)] for i in range(SAMPLES)
    ], dtype=np.float32)
    costs = np.full((SAMPLES + 1, SAMPLES + 1), np.inf, dtype=np.float32)
    costs[0, 0] = 0
    parent = {}
    for i in range(1, SAMPLES + 1):
        for j in range(1, SAMPLES + 1):
            options = ((costs[i - 1, j - 1], i - 1, j - 1),
                       (costs[i - 1, j] + 0.04, i - 1, j),
                       (costs[i, j - 1] + 0.04, i, j - 1))
            cost, previous_i, previous_j = min(options, key=lambda item: item[0])
            costs[i, j] = cost + distances[i - 1, j - 1]
            parent[(i, j)] = (previous_i, previous_j)
    path = []
    i = j = SAMPLES
    while i and j:
        path.append((i - 1, (j - 1 + offset) % SAMPLES))
        i, j = parent[(i, j)]
    return path[::-1]


def compare_pair(left: Fingerprint, right: Fingerprint) -> tuple[float, float, float]:
    _, offset = best_phase(left, right)
    path = align_frames(left, right, offset)
    # Evenly distributed aligned positions avoid overcounting repeated frames.
    picks = [path[round(i * (len(path) - 1) / 9)] for i in range(10)]
    hashes = [1 - (left.hashes[i] ^ right.hashes[j]).bit_count() / 63 for i, j in picks]
    structures = [max(0.0, structural_similarity(left.frames[i], right.frames[j], data_range=255))
                  for i, j in picks]
    hscore = float(np.mean(hashes))
    sscore = float(np.mean(structures))
    appearance = 0.45 * hscore + 0.55 * sscore
    movement = compare_motion(left.motion, right.motion)
    # Unreliable motion is neutral: static/isometric GIFs retain visual matching.
    combined = appearance if movement is None else 0.70 * appearance + 0.30 * movement
    return combined, hscore, sscore


def candidate_pairs(left: list[Fingerprint], right: list[Fingerprint]) -> dict[tuple[int, int], float]:
    appearance_a = np.stack([item.vector for item in left])
    appearance_b = np.stack([item.vector for item in right])
    visual = appearance_a @ appearance_b.T

    # Independent motion retrieval is essential: a male/female redraw of the
    # same movement can be absent from the visually nearest neighbours.
    motion_a = np.stack([item.motion.vector for item in left])
    motion_b = np.stack([item.motion.vector for item in right])
    movements = motion_a @ motion_b.T
    good_a = np.array([item.motion.reliable for item in left])
    good_b = np.array([item.motion.reliable for item in right])
    movements[~good_a, :] = -np.inf
    movements[:, ~good_b] = -np.inf

    pairs: set[tuple[int, int]] = set()
    for coarse in (visual, movements):
        for i in range(len(left)):
            for j in np.argsort(coarse[i])[-TOP_K:]:
                if np.isfinite(coarse[i, j]):
                    pairs.add((i, int(j)))
        for j in range(len(right)):
            for i in np.argsort(coarse[:, j])[-TOP_K:]:
                if np.isfinite(coarse[i, j]):
                    pairs.add((int(i), j))

    # Preserve top candidates of *both* channels. Hash-only shortlisting
    # would discard precisely the appearance-changing pairs we want to find.
    by_left_hash: dict[int, list[tuple[float, int]]] = {}
    by_right_hash: dict[int, list[tuple[float, int]]] = {}
    by_left_motion: dict[int, list[tuple[float, int]]] = {}
    by_right_motion: dict[int, list[tuple[float, int]]] = {}
    for i, j in pairs:
        hash_score, _ = best_phase(left[i], right[j])
        by_left_hash.setdefault(i, []).append((hash_score, j))
        by_right_hash.setdefault(j, []).append((hash_score, i))
        movement = compare_motion(left[i].motion, right[j].motion)
        if movement is not None:
            by_left_motion.setdefault(i, []).append((movement, j))
            by_right_motion.setdefault(j, []).append((movement, i))
    refined: set[tuple[int, int]] = set()
    for index, values in by_left_hash.items():
        refined.update((index, candidate) for _, candidate in sorted(values, reverse=True)[:EXACT_CANDIDATES])
    for index, values in by_right_hash.items():
        refined.update((candidate, index) for _, candidate in sorted(values, reverse=True)[:EXACT_CANDIDATES])
    for index, values in by_left_motion.items():
        refined.update((index, candidate) for _, candidate in sorted(values, reverse=True)[:EXACT_CANDIDATES])
    for index, values in by_right_motion.items():
        refined.update((candidate, index) for _, candidate in sorted(values, reverse=True)[:EXACT_CANDIDATES])
    scores = {}
    for count, (i, j) in enumerate(sorted(refined), 1):
        scores[(i, j)] = compare_pair(left[i], right[j])[0]
        if count % 500 == 0:
            print(f"Compared {count}/{len(refined)} shortlisted pairs", flush=True)
    return scores


def classify(n_left: int, n_right: int, scores: dict[tuple[int, int], float]):
    """Conservative mutual-best 1:1; uncertain near matches never become delta."""
    left_options: dict[int, list[tuple[float, int]]] = {}
    right_options: dict[int, list[tuple[float, int]]] = {}
    for (i, j), score in scores.items():
        left_options.setdefault(i, []).append((score, j))
        right_options.setdefault(j, []).append((score, i))
    for values in (*left_options.values(), *right_options.values()):
        values.sort(reverse=True)

    # Global 1:1 assignment is used only to select candidates, never to force a match.
    # Dummy columns let a GIF remain unmatched instead of forcing an incorrect pair.
    costs = np.full((n_left, n_right + n_left), 2.0, dtype=np.float32)
    for (i, j), score in scores.items():
        costs[i, j] = 1.0 - score
    for i in range(n_left):
        costs[i, n_right + i] = 1.0 - MATCH_THRESHOLD
    rows, cols = linear_sum_assignment(costs)
    matches = []
    for i, j in zip(rows.tolist(), cols.tolist()):
        if j >= n_right or (i, j) not in scores:
            continue
        score = scores[(i, j)]
        a = left_options[i]
        b = right_options[j]
        if (score >= MATCH_THRESHOLD and a[0][1] == j and b[0][1] == i
                and (len(a) == 1 or score - a[1][0] >= MATCH_MARGIN)
                and (len(b) == 1 or score - b[1][0] >= MATCH_MARGIN)):
            matches.append((i, j, score))
    matched_left = {i for i, _, _ in matches}
    matched_right = {j for _, j, _ in matches}

    # A plausible alternative to an already-matched file still needs review;
    # it is not evidence that the unmatched file is unique.
    reviews = [(i, j, score) for (i, j), score in scores.items()
               if score >= REVIEW_THRESHOLD
               and (i not in matched_left or j not in matched_right)]
    review_left = {i for i, _, _ in reviews if i not in matched_left}
    review_right = {j for _, j, _ in reviews if j not in matched_right}
    r2_only = [i for i in range(n_left) if i not in matched_left | review_left]
    github_only = [j for j in range(n_right) if j not in matched_right | review_right]
    return sorted(matches), sorted(reviews, key=lambda row: -row[2]), r2_only, github_only


def write_csv(path: Path, fields: list[str], records: list[list[object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as out:
        writer = csv.writer(out)
        writer.writerow(fields)
        writer.writerows(records)


def html_url(item: Fingerprint, is_r2: bool) -> str:
    branch = R2_BRANCH if is_r2 else "main"
    relative = item.path.relative_to(ROOT).as_posix()
    return "https://raw.githubusercontent.com/buropotok/mezfit/" + branch + "/" + quote(relative, safe="/")


def render_html(out: Path, left: list[Fingerprint], right: list[Fingerprint], matches, reviews, r2_only, github_only) -> None:
    def cell(item, is_r2):
        url = escape(html_url(item, is_r2), quote=True)
        label = escape(item.path.name)
        return f'<div><a href="{url}" target="_blank" rel="noopener"><img src="{url}" loading="lazy" width="126" alt="{label}"></a><div>{label}</div></div>'

    def table(title, rows):
        return f'<h2>{escape(title)} ({len(rows)})</h2><table><tbody>' + "".join(rows) + '</tbody></table>'

    match_rows = [f'<tr><td>{cell(left[i], True)}</td><td>{cell(right[j], False)}</td><td>{score:.3f}</td></tr>'
                  for i, j, score in matches]
    review_rows = [f'<tr><td>{cell(left[i], True)}</td><td>{cell(right[j], False)}</td><td>{score:.3f}</td></tr>'
                   for i, j, score in reviews]
    r2_rows = [f'<tr><td>{cell(left[i], True)}</td></tr>' for i in r2_only]
    github_rows = [f'<tr><td>{cell(right[j], False)}</td></tr>' for j in github_only]
    html = ("""<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Mezfit GIF media delta</title><style>
body{font:14px system-ui;background:#14171b;color:#eee;max-width:1100px;margin:auto;padding:24px}
a{color:#90c5ff}table{width:100%;border-collapse:collapse}
td{border-bottom:1px solid #343941;padding:10px;vertical-align:top}
td div{overflow-wrap:anywhere}img{background:white;max-height:150px;object-fit:contain}
nav a{margin-right:16px}h2{margin-top:48px}small{color:#aaa}
</style><h1>GIF visual audit</h1>
<p>Matching uses only animation content, never filenames or exercise metadata.</p>
<p><small>Review pairs are unconfirmed; they are not counted as unique GIFs. Images load from GitHub and require access to the repository.</small></p>""" +
            f'<p>Matched: {len(matches)} · Review pairs: {len(reviews)} · R2 only: {len(r2_only)} · GitHub only: {len(github_only)}</p>' +
            table("Provisional automatic 1:1 matches", match_rows) +
            table("Uncertain candidates — manual review", review_rows) +
            table("R2 only", r2_rows) +
            table("GitHub only", github_rows) + "</html>")
    (out / "review.html").write_text(html, encoding="utf-8")


def evidence_row(left: Fingerprint, right: Fingerprint, score: float) -> list[object]:
    """Keep separate evidence visible; fused confidence is not ground truth."""
    _, hash_score, structure_score = compare_pair(left, right)
    visual = 0.45 * hash_score + 0.55 * structure_score
    movement = compare_motion(left.motion, right.motion)
    return [
        left.path.name, right.path.name, f"{score:.5f}",
        f"{visual:.5f}", "" if movement is None else f"{movement:.5f}",
    ]


def evaluate_reviewed_controls(
    left: list[Fingerprint], right: list[Fingerprint],
    scores: dict[tuple[int, int], float], matches: list[tuple[int, int, float]], out: Path,
) -> str:
    """Measure candidate recall and sample errors without leaking labels into matching.

    The 30 volunteered decisions are diagnostic only. They never influence
    retrieval, scoring, thresholds, or pairing.
    """
    labels_file = ROOT / "tools/gif-audit/control-30-reviewed.csv"
    lookup_a = {item.path.name: i for i, item in enumerate(left)}
    lookup_b = {item.path.name: i for i, item in enumerate(right)}
    confirmed = {(i, j) for i, j, _ in matches}
    records = []
    with labels_file.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if len(rows) != 30 or {row["decision"] for row in rows} != {"yes", "no"}:
        raise ValueError("Reviewed control set is missing or malformed")
    seen = set()
    for label in rows:
        name_a, name_b = label["r2_gif"], label["github_gif"]
        if name_a not in lookup_a or name_b not in lookup_b:
            raise ValueError(f"Reviewed control media is absent: {name_a}, {name_b}")
        key = (lookup_a[name_a], lookup_b[name_b])
        if key in seen:
            raise ValueError("Duplicate reviewed pair")
        seen.add(key)
        fused, hash_score, ssim_score = compare_pair(left[key[0]], right[key[1]])
        appearance = 0.45 * hash_score + 0.55 * ssim_score
        movement = compare_motion(left[key[0]].motion, right[key[1]].motion)
        records.append([
            name_a, name_b, label["decision"], int(key in scores),
            int(key in confirmed), f"{appearance:.5f}",
            "" if movement is None else f"{movement:.5f}", f"{fused:.5f}",
        ])
    write_csv(
        out / "control-30-evaluation.csv",
        ["r2_gif", "github_gif", "human_decision", "retrieved_as_candidate",
         "auto_matched", "appearance_score", "motion_score", "combined_score"],
        records,
    )
    positives = [row for row in records if row[2] == "yes"]
    negatives = [row for row in records if row[2] == "no"]
    positive_retrieved = sum(row[3] for row in positives)
    false_accepts = sum(row[4] for row in negatives)
    true_accepts = sum(row[4] for row in positives)
    return (f"### Manually reviewed control sample (diagnostic, not a population estimate)\\n"
            f"- Human-positive pairs retrieved: {positive_retrieved}/{len(positives)}\\n"
            f"- Human-positive pairs automatically matched: {true_accepts}/{len(positives)}\\n"
            f"- Human-negative pairs incorrectly matched: {false_accepts}/{len(negatives)}\\n"
            f"- See control-30-evaluation.csv for independent visual and motion scores.\\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    import download_r2
    revision, ids = download_r2.approved_keys()
    download_r2.verify_snapshot(revision, ids, write_manifest=False)
    left = fingerprint_library(R2, expected_count=len(ids))
    right = fingerprint_library(GITHUB)
    scores = candidate_pairs(left, right)
    matches, reviews, r2_only, github_only = classify(len(left), len(right), scores)
    args.out.mkdir(parents=True, exist_ok=True)
    evidence_header = ["r2_gif", "github_gif", "score", "appearance_score", "motion_score"]
    write_csv(args.out / "matches.csv", evidence_header,
              [evidence_row(left[i], right[j], score) for i, j, score in matches])
    write_csv(args.out / "review.csv", evidence_header,
              [evidence_row(left[i], right[j], score) for i, j, score in reviews])
    write_csv(args.out / "r2_only.csv", ["r2_gif"], [[left[i].path.name] for i in r2_only])
    write_csv(args.out / "github_only.csv", ["github_gif"], [[right[j].path.name] for j in github_only])
    render_html(args.out, left, right, matches, reviews, r2_only, github_only)
    control_summary = evaluate_reviewed_controls(left, right, scores, matches, args.out)
    summary = (f"## GIF visual audit\\n\\n"
               f"R2: {len(left)} files; GitHub: {len(right)} files.\\n\\n"
               f"- Provisional auto matches (review required): {len(matches)}\\n"
               f"- Candidate pairs for review: {len(reviews)}\\n"
               f"- R2 only (no plausible candidate): {len(r2_only)}\\n"
               f"- GitHub only (no plausible candidate): {len(github_only)}\\n\\n"
               f"Experimental thresholds: auto match {MATCH_THRESHOLD}, review {REVIEW_THRESHOLD}, margin {MATCH_MARGIN}. "
               f"These thresholds require calibration against manually verified examples before migration.\\n\\n"
               f"{control_summary}")
    (args.out / "summary.md").write_text(summary.replace("\\n", "\n"), encoding="utf-8")
    print(summary.replace("\\n", "\n"), flush=True)


if __name__ == "__main__":
    main()
