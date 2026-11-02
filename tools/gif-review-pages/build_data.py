#!/usr/bin/env python3
"""Build read-only GH GIF -> R2 GIF manual-review candidates for GitHub Pages.

Uses the pinned GIF audit report and repository snapshots. Never edits catalogues.
"""
import argparse
import csv
import difflib
import heapq
import hashlib
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "assets" / "media"
DATA = ROOT / "audit" / "visual" / "input"
STOP = {"of", "the", "a", "an", "on", "with", "and", "in", "to", "for", "v", "male", "female"}
ALIASES = {
    "burpees": "burpee", "squats": "squat", "jumps": "jump",
    "pushups": "pushup", "pushup": "pushup", "push": "push",
    "pullups": "pullup", "pullup": "pullup",
    "dumbbells": "dumbbell", "cables": "cable",
    "raises": "raise", "crunches": "crunch", "rows": "row",
    "lunges": "lunge", "twists": "twist", "extensions": "extension",
    "single": "one", "unilateral": "one", "legged": "leg",
    "biceps": "bicep", "triceps": "tricep",
    "kneeling": "kneel", "lying": "lie", "seated": "sit",
}
WEIGHTS = {"title": 2.4, "visual": 2.0, "optical_flow": 1.0,
           "pose": 0.8, "joint_motion": 1.0}
ROUND_SIZE = 5
ROUND_COUNT = 6


def words(name):
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    parts = [ALIASES.get(p, p) for p in text.split() if p not in STOP]
    return parts


def title_score(a, b):
    aa, bb = set(a), set(b)
    if not aa or not bb:
        return 0.0
    common = len(aa & bb)
    jaccard = common / len(aa | bb)
    coverage = common / min(len(aa), len(bb))
    a_sorted, b_sorted = " ".join(sorted(a)), " ".join(sorted(b))
    basic = difflib.SequenceMatcher(None, a_sorted, b_sorted).ratio()
    return round(0.48 * jaccard + 0.22 * coverage + 0.30 * basic, 6)


def read_r2():
    entries = {}
    for stage in range(1, 15):
        file = DATA / ("catalogue_stage_%02d.jsonl" % stage)
        with file.open(encoding="utf-8") as src:
            for line in src:
                if not line.strip():
                    continue
                d = json.loads(line)
                ident = str(d["id"]).zfill(4)
                if ident in entries:
                    raise ValueError("Duplicate R2 ID: " + ident)
                entries[ident] = {
                    "id": ident, "name": d["name_en"],
                    "equipment": d.get("equipment") or "",
                    "gif": ident + ".gif",
                }
    if len(entries) != 1324:
        raise ValueError("R2 source must contain 1324 unique IDs")
    return entries


def read_gh():
    gifs = {p.name for p in MEDIA.glob("*.gif")}
    names = {}
    for path in (ROOT / "assets" / "exercises").glob("*/*.json"):
        if path.name == "_manifest.json":
            continue
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as ex:
            raise ValueError("Invalid exercise JSON: " + str(path)) from ex
        key = d.get("image_id")
        if key not in gifs:
            continue
        name = d.get("name")
        if isinstance(name, str) and name.strip():
            names.setdefault(key, name.strip())
    if len(gifs) != 1168:
        raise ValueError("Expected frozen 1168 GIFs, got %s" % len(gifs))
    return {key: names.get(key, Path(key).stem.replace("-", " "))
            for key in sorted(gifs)}


def number(raw):
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def add_evidence(bucket, r2_ids, gh, ident, field, score):
    if gh not in bucket or ident not in r2_ids or score is None:
        return
    if score < 0:
        return
    pair = bucket[gh].setdefault(ident, {})
    pair[field] = max(pair.get(field, float("-inf")), score)


def load_audit(audit_dir, bucket, r2_ids):
    for filename in ("matches.csv", "review.csv"):
        path = audit_dir / filename
        with path.open(newline="", encoding="utf-8-sig") as f:
            for d in csv.DictReader(f):
                gh, ident = d["github_gif"], d["r2_gif"].removesuffix(".gif")
                add_evidence(bucket, r2_ids, gh, ident, "visual", number(d["appearance_score"]))
                add_evidence(bucket, r2_ids, gh, ident, "optical_flow", number(d["motion_score"]))
    path = audit_dir / "pose-candidates.csv"
    with path.open(newline="", encoding="utf-8-sig") as f:
        for d in csv.DictReader(f):
            gh, ident = d["github_gif"], d["r2_gif"].removesuffix(".gif")
            add_evidence(bucket, r2_ids, gh, ident, "pose", number(d["pose_score"]))
            add_evidence(bucket, r2_ids, gh, ident, "joint_motion", number(d["joint_motion_score"]))


def generate(audit_dir, output_dir, github_ref):
    if not re.fullmatch(r"[a-f0-9]{40}", github_ref):
        raise ValueError("GitHub source must be pinned by a 40-char commit SHA")
    r2, gh = read_r2(), read_gh()
    # Sparse per-GIF pair registry: only retain retrieved evidence.
    bucket = {name: {} for name in gh}
    load_audit(audit_dir, bucket, set(r2))

    r2_tokens = {key: words(item["name"]) for key, item in r2.items()}
    gh_tokens = {key: words(title) for key, title in gh.items()}
    # Independent title channel in both directions; do not discard candidates
    # retrieved from static visual, optical flow, pose or joint motion.
    inverse = {key: [] for key in r2}
    for name, tokens in gh_tokens.items():
        scores = []
        for ident, rtokens in r2_tokens.items():
            value = title_score(tokens, rtokens)
            scores.append((value, ident))
            heapq.heappush(inverse[ident], (value, name))
            if len(inverse[ident]) > 6:
                heapq.heappop(inverse[ident])
        scores.sort(key=lambda item: (-item[0], item[1]))
        for value, ident in scores[:50]:
            bucket[name].setdefault(ident, {})["title"] = value

    for ident, ranked in inverse.items():
        for value, name in ranked:
            bucket[name].setdefault(ident, {})["title"] = value

    entries = []
    evidence_rows = []
    for name, title in gh.items():
        pairs = bucket[name]
        # Rank separately per independent channel, with stable tie-breaking.
        rankings = {}
        for channel in WEIGHTS:
            ranked = sorted(((data[channel], ident) for ident, data in pairs.items()
                             if channel in data and data[channel] > 0),
                            key=lambda item: (-item[0], item[1]))
            rankings[channel] = {ident: rank for rank, (_, ident) in
                                 enumerate(ranked, start=1)}
        results = []
        for ident, scores in pairs.items():
            if not scores:
                continue
            ranks = {ch: ranks[ident] for ch, ranks in rankings.items()
                     if ident in ranks}
            if not ranks:
                continue
            fused = sum(WEIGHTS[ch] / (40 + rank) for ch, rank in ranks.items())
            # These are retrieval scores, NOT probabilities of identity.
            results.append((fused, ident, ranks, scores))
        results.sort(key=lambda item: (-item[0], item[1]))
        candidates = []
        for rank, (fused, ident, ranks, scores) in enumerate(results, start=1):
            if rank <= ROUND_SIZE * ROUND_COUNT:
                candidates.append({
                    "id": ident, "name": r2[ident]["name"],
                    "equipment": r2[ident]["equipment"], "rank": rank,
                    "channels": sorted(ranks), "fusion": round(fused, 7)
                })
            evidence_rows.append({
                "github_gif": name, "github_name_en": title,
                "r2_id": ident, "r2_name_en": r2[ident]["name"],
                "rank": rank, "fusion_retrieval_score": round(fused, 7),
                **{ch + "_rank": ranks.get(ch, "") for ch in WEIGHTS},
                **{ch + "_score": scores.get(ch, "") for ch in WEIGHTS},
            })
        if len(candidates) < 5:
            raise ValueError("Fewer than five candidates for " + name)
        entries.append({"gif": name, "name": title, "candidates": candidates})

    fingerprint = "\n".join(
        item["gif"] + ":" + ",".join(c["id"] for c in item["candidates"])
        for item in entries
    )
    # Identical candidate order alone is insufficient if underlying GH GIFs
    # changed: also fingerprint the versioned media Git tree.
    media_tree = subprocess.check_output(
        ["git", "rev-parse", "HEAD:assets/media"], cwd=ROOT, text=True
    ).strip()
    revision = hashlib.sha256((media_tree + "\n" + fingerprint).encode("utf-8")).hexdigest()
    out = {
        "schema_version": 1, "direction": "github_gif_to_r2_gif",
        "candidate_revision": revision, "github_ref": github_ref,
        "r2_count": len(r2), "github_count": len(gh),
        "round_size": ROUND_SIZE, "max_rounds": ROUND_COUNT,
        "sources": {
            "r2_catalogue": "audit/visual/input/catalogue_stage_{NN}.jsonl",
            "r2_source_sha256": "5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c",
            "github_exercises": "assets/exercises/**.json",
            "audit": "gif-visual-delta-report (matches/review/pose-candidates)",
            "ranker": "independent-channel reciprocal-rank-fusion v1",
            "note": "Original pinned R2 English names; semantic model review not performed.",
        },
        "items": entries,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "candidates.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with (output_dir / "evidence.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=list(evidence_rows[0]))
        writer.writeheader()
        writer.writerows(evidence_rows)
    print("Generated %d GH items and %d evidence pairs; %d candidates per round" %
          (len(entries), len(evidence_rows), ROUND_SIZE))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--github-ref", required=True)
    args = parser.parse_args()
    generate(args.audit_dir, args.out, args.github_ref)


if __name__ == "__main__":
    main()
