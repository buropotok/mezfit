"""Visually ordered review of the 749 GIFs outside the frozen 419 audit matches.

The original fused visual score is used where review.csv contains it. GIFs
below the reporting threshold are ordered separately by static-pose similarity,
a different, explicitly uncalibrated metric. Missing visual evidence stays
missing; metadata may still propose alternatives but never invents a score.
"""
import csv
import math
from pathlib import Path

from visual_review_v3 import (
    _compatibility,
    equipment_tags,
    load_gh_metadata,
    semantic_alternatives,
)

EXPECTED_REMAINING = 749


def _score(value, allow_missing=False):
    if value is None or value == "":
        if allow_missing:
            return None
        raise ValueError("Missing similarity score in visual audit")
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError("Invalid visual similarity score: " + str(value))
    return result


def _best_visual_rows(path, available_gifs, r2, score_column):
    """Retain the maximum *original-channel* score per GH GIF; never mix scales."""
    best = {}
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            gif = row["github_gif"]
            if gif not in available_gifs:
                continue
            ident = row["r2_gif"].removesuffix(".gif")
            if ident not in r2:
                raise ValueError("Visual candidate is missing from R2 inventory")
            score = _score(row.get(score_column), allow_missing=True)
            if score is None:
                continue
            previous = best.get(gif)
            if previous is None or (-score, ident) < (-previous[0], previous[1]):
                best[gif] = (score, ident)
    return best


def build_remaining_review(audit_dir, gh_names, r2, exercise_root,
                           words, title_score, confirmed_gifs,
                           expected_count=EXPECTED_REMAINING):
    """Return candidates and sorting evidence for all unconfirmed GIFs.

    Tiers: 0 = fused visual appearance/motion (comparable only within tier);
           1 = pose-position fallback, uncalibrated and *not* fused with tier 0;
           2 = no visual evidence, metadata-only alternatives when possible.
    """
    remaining = set(gh_names) - set(confirmed_gifs)
    if len(remaining) != expected_count:
        raise ValueError("Expected %d unconfirmed GIFs, got %d" %
                         (expected_count, len(remaining)))
    audit = Path(audit_dir)
    visual = _best_visual_rows(audit / "review.csv", remaining, r2, "score")
    pose = _best_visual_rows(audit / "pose-candidates.csv", remaining - set(visual),
                             r2, "pose_score")
    gh_metadata = load_gh_metadata(exercise_root, remaining)
    result = {}
    for gif in sorted(remaining):
        source = gh_metadata.get(gif, {"name": gh_names[gif]})
        primary = None
        if gif in visual:
            similarity, ident = visual[gif]
            tier, channel, kind = 0, "appearance_motion", "visual_review"
            label = "Визуальный аудит"
        elif gif in pose:
            similarity, ident = pose[gif]
            tier, channel, kind = 1, "pose_position", "pose_position"
            label = "Положение суставов"
        else:
            similarity, ident = None, None
            tier, channel, kind = 2, "none", None
            label = None

        candidates = []
        if ident is not None:
            target = r2[ident]
            warnings, _ = _compatibility(source, target, words)
            candidates.append({
                "id": ident, "name": target["name"],
                "equipment": target.get("equipment", ""), "rank": 1,
                "source": kind, "channels": [label],
                "similarity_score": round(similarity, 5),
                "score_channel": channel,
                "source_equipment": ", ".join(sorted(equipment_tags(
                    source.get("equipment"), source.get("name", "")))),
                "metadata_warnings": warnings,
            })

        candidates.extend(semantic_alternatives(
            source, gh_names[gif], r2, words, title_score,
            excluded_ids={ident} if ident is not None else set(),
            limit=4 if ident is not None else 5,
            start_rank=2 if ident is not None else 1,
        ))
        result[gif] = {
            "candidates": candidates,
            "priority": {
                "tier": tier,
                "score": round(similarity, 5) if similarity is not None else None,
                "channel": channel,
            },
        }
    return result
