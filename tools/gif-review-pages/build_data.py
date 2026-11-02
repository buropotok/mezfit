#!/usr/bin/env python3
"""Build read-only GH GIF -> R2 GIF manual-review candidates for GitHub Pages.

Uses the pinned GIF audit report and repository snapshots. Never edits catalogues.
"""
import argparse
import csv
import heapq
import hashlib
import math
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "assets" / "media"
DATA = ROOT / "audit" / "visual" / "input"
STOP = {"of", "the", "a", "an", "on", "with", "and", "in", "to", "for",
        "v", "male", "female", "exercise"}
ALIASES = {
    "burpees": "burpee", "squats": "squat", "jumps": "jump",
    "pushups": "pushup", "pullups": "pullup", "situps": "situp",
    "dumbbells": "dumbbell", "cables": "cable", "bands": "band",
    "banded": "band", "raises": "raise", "crunches": "crunch",
    "rows": "row", "lunges": "lunge", "twists": "twist",
    "extensions": "extension", "dips": "dip",
    "single": "single", "unilateral": "single", "one": "single",
    "legged": "leg", "biceps": "bicep", "triceps": "tricep",
    "kneeling": "kneel", "lying": "lie", "seated": "sit",
    "forward": "front", "backward": "back", "rearward": "rear",
    "inclined": "incline", "declined": "decline", "planks": "plank",
    "running": "run", "skipping": "skip", "calves": "calf",
    "rollerout": "rollout", "rollouts": "rollout",
    "pulldowns": "pulldown", "flyes": "fly", "flies": "fly",
    "presses": "press", "curls": "curl", "shrugs": "shrug",
    "pullovers": "pullover", "bridges": "bridge",
    "stretches": "stretch", "frontwards": "front",
}
MOVEMENTS = {
    "squat", "deadlift", "press", "raise", "row", "curl", "lunge",
    "pushup", "pullup", "dip", "crunch", "rollout", "stretch",
    "extension", "bridge", "jump", "run", "walk", "skip",
    "plank", "fly", "pull", "pulldown", "pullover", "swing",
    "clean", "snatch", "thruster", "twist", "rotate", "kick",
    "throw", "slam", "shrug", "situp", "carry",
}
EQUIPMENT = {"dumbbell", "barbell", "kettlebell", "cable", "band",
             "smith", "machine", "lever", "ring", "trx", "medicine",
             "plate", "bosu", "roller", "wheel"}
EXCLUSIVE_EQUIPMENT = {"dumbbell", "barbell", "kettlebell", "cable",
                       "band", "smith", "machine", "lever", "ring", "trx"}
WEIGHTS = {"title": 2.4, "visual": 2.0, "optical_flow": 1.0,
           "pose": 0.8, "joint_motion": 1.0}
ROUND_SIZE = 5
ROUND_COUNT = 6


def words(name):
    """Normalize naming, but never treat common variant version numbers as movement words."""
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name or "")
    name = re.sub(r"\bv\s*\.?\s*\d+\b", " ", name, flags=re.I)
    name = re.sub(r"\bpush[\s_-]*ups?\b", " pushup ", name, flags=re.I)
    name = re.sub(r"\bpull[\s_-]*ups?\b", " pullup ", name, flags=re.I)
    name = re.sub(r"\bsit[\s_-]*ups?\b", " situp ", name, flags=re.I)
    name = re.sub(r"[^a-z0-9]+", " ", name.lower())
    return [ALIASES.get(p, p) for p in name.split() if p not in STOP]


def title_score(a, b):
    """Weighted semantic-token similarity; no weak shared word can imply equality."""
    aa, bb = set(a), set(b)
    if not aa or not bb:
        return 0.0
    def weight(term):
        return 3.0 if term in MOVEMENTS else (2.0 if term in EQUIPMENT else 1.0)
    shared = sum(weight(t) for t in aa & bb)
    total = sum(weight(t) for t in aa | bb)
    smaller = min(sum(weight(t) for t in aa), sum(weight(t) for t in bb))
    score = 0.7 * shared / total + 0.3 * shared / smaller
    am, bm = aa & MOVEMENTS, bb & MOVEMENTS
    if am and bm and not am.intersection(bm):
        score *= 0.18  # e.g. squat versus deadlift
    ae, be = aa & EXCLUSIVE_EQUIPMENT, bb & EXCLUSIVE_EQUIPMENT
    if ae and be and not ae.intersection(be):
        score *= 0.58  # different apparatus can mean different variants
    return round(score, 6)


def title_class(a, b):
    """Distinguish exact, versioned, strongly related, and weak name matches."""
    if not a or not b:
        return 0
    aa, bb = set(a), set(b)
    if aa == bb:
        return 3
    sim = title_score(a, b)
    if sim >= 0.56 and (aa & MOVEMENTS) == (bb & MOVEMENTS) and (aa & MOVEMENTS):
        return 2
    if sim >= 0.50 and (aa & MOVEMENTS) & (bb & MOVEMENTS):
        return 1
    return 0


def visual_support(ranks):
    """Independent imagery and body-motion families. No double-counting flow+image."""
    visual = max((1.0 / (15 + ranks[c]) for c in ("visual", "optical_flow")
                  if c in ranks), default=0.0)
    pose = max((1.0 / (15 + ranks[c]) for c in ("pose", "joint_motion")
                if c in ranks), default=0.0)
    return visual + 0.6 * pose


def order_candidates(pairs, gh_words, r2_words):
    """Give strong names priority, reserve independent visual retrieval in Top-5.

    A lexical match is a retrieval hypothesis, never an automatic exercise match.
    Visual fallback is crucial for equivalent exercises with unrelated names.
    """
    rankings = {}
    for channel in WEIGHTS:
        listed = sorted(((signals[channel], ident) for ident, signals in pairs.items()
                         if channel in signals and signals[channel] > 0),
                        key=lambda entry: (-entry[0], entry[1]))
        rankings[channel] = {ident: pos for pos, (_, ident) in enumerate(listed, 1)}

    all_rows = []
    for ident, scores in pairs.items():
        ranks = {ch: ranked[ident] for ch, ranked in rankings.items() if ident in ranked}
        tokens = r2_words[ident]
        alignment = title_score(gh_words, tokens)
        kind = title_class(gh_words, tokens)
        visual = visual_support(ranks)
        exact = 1 if set(gh_words) == set(tokens) and tokens else 0
        # Exact spelling is ahead of 'v.2'; among versions prefer motion agreement.
        fused = sum(WEIGHTS[ch] / (40 + rank) for ch, rank in ranks.items())
        all_rows.append({
            "id": ident, "scores": scores, "ranks": ranks, "semantic": alignment,
            "kind": kind, "exact": exact, "visual_support": visual,
            "fusion": fused,
        })

    # Sufficiently similar motion/terminology is ranked independently of
    # incidental extra visual-channel evidence (which can be highly correlated).
    strong = sorted(
        (x for x in all_rows if x["kind"] >= 1),
        key=lambda x: (-x["exact"], -x["kind"], -x["semantic"],
                       -x["visual_support"], x["id"])
    )
    # Explore a visually retrieved alternative in first five even when names
    # differ. Visual-only matches remain human-reviewed; never automatically paired.
    visual = sorted(
        (x for x in all_rows if x["visual_support"] > 0),
        key=lambda x: (-x["visual_support"], -x["semantic"], x["id"])
    )
    selected, taken = [], set()
    def append(item):
        if item["id"] not in taken:
            selected.append(item)
            taken.add(item["id"])

    # Four strongest semantic candidates, including ALL highest-priority exact
    # ones up to capacity; leave one slot for truly independent visual retrieval.
    for item in strong[:ROUND_SIZE - 1]:
        append(item)
    for item in visual:
        if len(selected) >= ROUND_SIZE:
            break
        if item["kind"] == 0:
            append(item)
    # When all visual retrievals also share the movement name, take the
    # strongest remaining visually supported name instead of a random pair.
    for item in visual:
        if len(selected) >= ROUND_SIZE:
            break
        append(item)
    # If no visual data is available, finish the page from names.
    for item in strong:
        if len(selected) >= ROUND_SIZE:
            break
        append(item)
    # Rank other candidates for subsequent rounds. Include non-strong
    # semantic matches and visually retrieved pairs; preserve all evidence.
    remainder = sorted(
        (item for item in all_rows if item["id"] not in taken),
        key=lambda x: (-x["kind"], -x["semantic"], -x["visual_support"],
                       -x["fusion"], x["id"])
    )
    selected.extend(remainder)
    for index, item in enumerate(selected, 1):
        item["rank"] = index
    return selected


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
        parsed = float(raw)
        return parsed if math.isfinite(parsed) else None
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
    # Bidirectional name retrieval using semantic movement/equipment tokens.
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
        ordered = order_candidates(pairs, gh_tokens[name], r2_tokens)
        candidates = []
        for item in ordered:
            ident = item["id"]
            ranks, scores = item["ranks"], item["scores"]
            if item["rank"] <= ROUND_SIZE * ROUND_COUNT:
                candidates.append({
                    "id": ident, "name": r2[ident]["name"],
                    "equipment": r2[ident]["equipment"], "rank": item["rank"],
                    "channels": sorted(ranks), "fusion": round(item["fusion"], 7)
                })
            evidence_rows.append({
                "github_gif": name, "github_name_en": title,
                "r2_id": ident, "r2_name_en": r2[ident]["name"],
                "rank": item["rank"],
                "semantic_title_score": item["semantic"],
                "semantic_class": item["kind"],
                "visual_support": round(item["visual_support"], 7),
                "fusion_retrieval_score": round(item["fusion"], 7),
                **{ch + "_rank": ranks.get(ch, "") for ch in WEIGHTS},
                **{ch + "_score": scores.get(ch, "") for ch in WEIGHTS},
            })
        if len(candidates) < ROUND_SIZE * ROUND_COUNT:
            raise ValueError("Fewer than 30 candidates for " + name)
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
        "r2_index": {ident: item["name"] for ident, item in r2.items()},
        "sources": {
            "r2_catalogue": "audit/visual/input/catalogue_stage_{NN}.jsonl",
            "r2_source_sha256": "5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c",
            "github_exercises": "assets/exercises/**.json",
            "audit": "gif-visual-delta-report (matches/review/pose-candidates)",
            "ranker": "semantic-title-first with independent visual exploration v2",
            "note": "English-title semantic dictionary + visual/motion retrieval; not an LLM verdict.",
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
