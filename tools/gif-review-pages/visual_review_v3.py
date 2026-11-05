"""The 419 visual-audit pairs as a human-review queue, not automatic matches.

Semantic alternatives are independently retrieved from full exercise metadata.
No output of this module changes catalogue records or accepts a match.
"""
import csv
import json
import math
import re
from collections import Counter
from pathlib import Path

EXPECTED_VISUAL_PAIRS = 419

TECHNIQUE_STOP = set("""
a an and as at be by do each for from has have in into is it its of on or
other out over repeat same should side slight slightly slowly start starting
then the their them these this throughout to towards until up use using while
with your you can desired number repetitions exercise movement position
return continue keep keeping make sure begin back again fully
""".split())

EQUIPMENT_TERMS = (
    ("smith", ("smith",)),
    ("barbell", ("barbell", "ez bar", "olympic bar")),
    ("dumbbell", ("dumbbell",)),
    ("kettlebell", ("kettlebell",)),
    ("cable", ("cable", "pulley")),
    ("band", ("resistance band", "elastic band", "band")),
    ("machine", ("machine", "lever")),
    ("trx", ("trx", "suspension trainer")),
    ("ring", ("gymnastic ring", "rings")),
    ("medicine_ball", ("medicine ball", "medicine-ball")),
    ("stability_ball", ("stability ball", "swiss ball", "fitball")),
    ("plate", ("weight plate",)),
    ("bench", ("bench",)),
    ("roller", ("foam roller", "ab wheel", "roller")),
)
ACTIONS = set("""
squat lunge deadlift press pushup pullup row curl fly raise extension
pulldown pullover crunch situp dip plank bridge thrust jump clean snatch
jerk swing twist rotate stretch run walk carry shrug kick rollout
""".split())
EQUIPMENT_ALIAS = {
    "body weight": "bodyweight", "bodyweight": "bodyweight",
    "no equipment": "bodyweight", "without equipment": "bodyweight",
    "none": "bodyweight"
}


def _text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return " ".join(v for v in value if isinstance(v, str))
    return ""


def equipment_tags(value, title=""):
    """Trust explicit apparatus; 'Full Gym' is a location, not equipment."""
    raw = _text(value).lower().replace("_", " ").replace("-", " ")
    raw = raw.replace("full gym", "").strip()
    if not raw:
        raw = title.lower()
    if any(marker in raw for marker in EQUIPMENT_ALIAS):
        return {"bodyweight"}
    found = {canonical for canonical, aliases in EQUIPMENT_TERMS
             if any(alias in raw for alias in aliases)}
    # Machine subtypes should not conflict with the generic word 'machine'.
    if "smith" in found:
        found.discard("machine")
    if "cable" in found:
        found.discard("machine")
    return found


def _terms(text):
    tokens = re.findall(r"[a-z]+", (text or "").lower().replace("_", " "))
    return {token[:-1] if token.endswith("s") and not token.endswith("ss")
            and len(token) > 5 else token
            for token in tokens if len(token) >= 4 and token not in TECHNIQUE_STOP}


def _primary_muscles(record):
    raw = record.get("muscles")
    parts = []
    if isinstance(raw, dict):
        for field in ("target", "primary"):
            value = raw.get(field)
            parts.extend(value if isinstance(value, list) else [value or ""])
    parts.append(record.get("target") or "")
    parts.extend(record.get("muscle_group") if isinstance(record.get("muscle_group"), list)
                 else [record.get("muscle_group") or ""])
    return _terms(_text(parts))


def _motion_tags(name, words):
    return set(words(name)) & ACTIONS


def _technique_score(a, b, document_frequency, count):
    aa, bb = _terms(a), _terms(b)
    if not aa or not bb:
        return 0.0
    def weight(term):
        return 1.0 + math.log((count + 1) / (1 + document_frequency.get(term, 0)))
    common = sum(weight(term) for term in aa & bb)
    denominator = math.sqrt(sum(weight(t) for t in aa) * sum(weight(t) for t in bb))
    return common / denominator if denominator else 0.0


def _compatibility(source, target, words):
    source_equipment = equipment_tags(source.get("equipment"), source.get("name", ""))
    target_equipment = equipment_tags(target.get("equipment"), target.get("name", ""))
    source_motion = _motion_tags(source.get("name", ""), words)
    target_motion = _motion_tags(target.get("name", ""), words)
    warnings = []
    if source_equipment and target_equipment and source_equipment.isdisjoint(target_equipment):
        warnings.append("Противоречие оборудования: " +
                        ", ".join(sorted(source_equipment)) + " / " +
                        ", ".join(sorted(target_equipment)))
    if source_motion and target_motion and source_motion.isdisjoint(target_motion):
        warnings.append("Возможное противоречие движения: " +
                        ", ".join(sorted(source_motion)) + " / " +
                        ", ".join(sorted(target_motion)))
    return warnings, bool(source_equipment and target_equipment and
                          not source_equipment.isdisjoint(target_equipment))


def load_gh_metadata(exercise_root, available_gifs):
    """Only asset JSON records with a GIF actually present in the frozen inventory."""
    result = {}
    for path in sorted(Path(exercise_root).glob("*/*.json")):
        if path.name == "_manifest.json":
            continue
        source = json.loads(path.read_text(encoding="utf-8"))
        gif = source.get("image_id")
        if gif in available_gifs and gif not in result:
            result[gif] = source
    return result


def build_visual_review(audit_dir, gh_names, r2, exercise_root, words, title_score):
    """Return per-GH visual candidate lists with the audited pair always first."""
    gh_metadata = load_gh_metadata(exercise_root, set(gh_names))
    document_frequency = Counter()
    for row in r2.values():
        document_frequency.update(_terms(row.get("instructions_en", "")))
    source_count = len(r2)
    seen_ids, seen_gifs = set(), set()
    result = {}
    with (Path(audit_dir) / "matches.csv").open(newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            gif = row["github_gif"]
            ident = row["r2_gif"].removesuffix(".gif")
            if gif not in gh_names or ident not in r2:
                raise ValueError("Visual match does not belong to the frozen inventories")
            if gif in seen_gifs or ident in seen_ids:
                raise ValueError("Visual matches must be unique 1:1 hypotheses")
            seen_gifs.add(gif)
            seen_ids.add(ident)
            scores = [float(row[k]) for k in ("score", "appearance_score")]
            if row.get("motion_score"):
                scores.append(float(row["motion_score"]))
            if any(not math.isfinite(value) or not 0 <= value <= 1 for value in scores):
                raise ValueError("Invalid visual-audit score")
            source = gh_metadata.get(gif, {"name": gh_names[gif]})
            primary = r2[ident]
            warnings, _ = _compatibility(source, primary, words)
            candidates = [{
                "id": ident, "name": primary["name"],
                "equipment": primary.get("equipment", ""), "rank": 1,
                "source": "visual_audit", "channels": ["Визуальный аудит"],
                "audit_score": round(float(row["score"]), 5),
                "source_equipment": ", ".join(sorted(
                    equipment_tags(source.get("equipment"), source.get("name", "")))),
                "metadata_warnings": warnings
            }]
            alternatives = []
            src_tokens = words(gh_names[gif])
            src_description = source.get("how_to") or ""
            src_muscles = _primary_muscles(source)
            for alt_id, candidate in r2.items():
                if alt_id == ident:
                    continue
                warnings, same_equipment = _compatibility(source, candidate, words)
                if warnings:
                    continue
                name_sim = title_score(src_tokens, words(candidate["name"]))
                technique = _technique_score(src_description,
                                             candidate.get("instructions_en", ""),
                                             document_frequency, source_count)
                target_muscles = _primary_muscles(candidate)
                muscle = (len(src_muscles & target_muscles) /
                          len(src_muscles | target_muscles)) if (src_muscles and target_muscles) else 0.0
                # A modest generic description overlap alone never fills a card.
                if name_sim < 0.34 and not (technique >= 0.22 and muscle >= 0.15):
                    continue
                rating = (0.60 * name_sim + 0.24 * technique +
                          0.10 * muscle + 0.06 * int(same_equipment))
                signals = []
                if name_sim >= 0.34:
                    signals.append("Название")
                if technique >= 0.14:
                    signals.append("Техника")
                if same_equipment:
                    signals.append("Оборудование")
                if muscle >= 0.15:
                    signals.append("Мышцы")
                alternatives.append((rating, alt_id, candidate, signals))
            alternatives.sort(key=lambda x: (-x[0], x[1]))
            for index, (rating, alt_id, candidate, signals) in enumerate(alternatives[:4], 2):
                candidates.append({
                    "id": alt_id, "name": candidate["name"],
                    "equipment": candidate.get("equipment", ""),
                    "rank": index, "source": "semantic",
                    "channels": signals,
                    "semantic_score": round(rating, 6),
                    "metadata_warnings": []
                })
            result[gif] = candidates
    if len(result) != EXPECTED_VISUAL_PAIRS:
        raise ValueError("Expected %d fixed visual pairs, received %d" %
                         (EXPECTED_VISUAL_PAIRS, len(result)))
    return result
