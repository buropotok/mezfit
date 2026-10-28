#!/usr/bin/env python3
"""Build reviewed Russian exercise catalogue; preserve each current original field.

No fuzzy translation, no translation fallback, and no writes to assets/exercises.
A missing editorial mapping fails the entire build. --category only controls
which missing work records are emitted to the GitHub Actions log for batch import.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "exercises"
TARGET = ROOT / "assets" / "work"
TOOL_DIR = ROOT / "tools" / "exercise-work"
MANUAL_CATEGORIES = (
    "abs", "back", "biceps", "calf", "cardio", "erector-spinae", "forearm",
    "full-body", "hip", "leg", "shoulders", "trapezius", "triceps",
)
ALL_CATEGORIES = set(MANUAL_CATEGORIES) | {"chest", "neck"}
VALID_TYPES = {"weight_reps", "time", "time_distance", "time_reps", "time_weight"}

REVIEW_CASES = [
    {"path": "cardio/wheel-run.json", "reason": "Пустая инструкция и неочевидный способ измерения дистанции"},
    {"path": "cardio/walk-wave-machine.json", "reason": "Нет техники выполнения; следует уточнить метрики тренажёра"},
    {"path": "cardio/vibration-plate.json", "reason": "Нет техники выполнения; требуется уточнить статический режим"},
    {"path": "shoulders/backhand-raise.json", "reason": "Нет инструкции, название допускает варианты движения"},
    {"path": "shoulders/lever-reverse-shoulder-press.json", "reason": "Неясна механика обратного жима в тренажёре"},
    {"path": "leg/hawaiian-squat.json", "reason": "Инструкция содержит преимущественно описание пользы, а не технику"},
    {"path": "hip/squat-mobility-complex.json", "reason": "Отсутствует описание последовательности упражнений комплекса"},
    {"path": "cardio/hook-kick.json", "reason": "Нет инструкции; уточнить разновидность удара ногой"},
    {"path": "abs/ab-roller-crunch.json", "reason": "Нет техники; уточнить разновидность тренажёра"},
    {"path": "full-body/plate-push.json", "reason": "Уточнить способ учёта перемещения отягощения"},
    {"path": "back/rope-climb.json", "reason": "Уточнить предпочтение повторений или времени при лазании по канату"},
    {"path": "abs/teaser-pilates.json", "reason": "Неоднозначно, считать подъёмы или удержание позы"},
    {"path": "cardio/stationary-bike-run.json", "reason": "Не указано, измеряет ли исходный тренажёр дистанцию"},
]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    text = re.sub(r"\((male|female)\)", " ", text)
    return " ".join(re.findall(r"[a-z0-9]+", text))


def read_obj(path: Path) -> dict:
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return obj


def identity(obj: dict) -> str:
    if not isinstance(obj.get("name"), str) or not obj["name"].strip():
        raise ValueError("Missing English exercise name")
    return str(obj.get("source_url") or normalize(obj["name"]))


def validate_pair(ru: object, kind: object, label: str) -> tuple[str, str]:
    if not isinstance(ru, str) or not ru.strip() or not re.search(r"[А-Яа-яЁё]", ru):
        raise ValueError(f"Missing or non-Russian title: {label}: {ru!r}")
    if not isinstance(kind, str) or kind not in VALID_TYPES:
        raise ValueError(f"Invalid tracking type: {label}: {kind!r}")
    return ru.strip(), kind


def build(category: str) -> None:
    if category not in MANUAL_CATEGORIES:
        raise ValueError("Unexpected output category")
    originals = sorted(p for p in SOURCE.glob("*/*.json") if p.name != "_manifest.json")
    if len(originals) != 1673 or {p.parent.name for p in originals} != ALL_CATEGORIES:
        raise ValueError(f"Unexpected source inventory: {len(originals)} files")

    reference_raw = read_obj(TOOL_DIR / "ru-names-reference.json")["names"]
    reference = {}
    for en, ru in reference_raw.items():
        key = normalize(en)
        if key not in reference:
            reference[key] = ru.strip()
    ref_types = read_obj(TOOL_DIR / "curated-reference-tracking.json")
    if len(ref_types) != 167 or any(v not in VALID_TYPES for v in ref_types.values()):
        raise ValueError("Reference-based classifications are incomplete")

    manual = {}
    for area in MANUAL_CATEGORIES:
        source = read_obj(TOOL_DIR / f"curated-{area}.json")
        for en, value in source.items():
            if not isinstance(value, dict):
                raise ValueError(f"Malformed manual translation: {en}")
            pair = validate_pair(value.get("name_ru"), value.get("tracking_type"), en)
            if en in manual and manual[en] != pair:
                raise ValueError(f"Conflicting manual translation: {en}")
            manual[en] = pair

    reviewed = {}
    old_paths = set(TARGET.glob("*/*.json"))
    if len(old_paths) != 178:
        raise ValueError(f"Expected 178 reviewed files, got {len(old_paths)}")
    for p in sorted(old_paths):
        obj = read_obj(p)
        key = identity(obj)
        pair = validate_pair(obj.get("name_ru"), obj.get("tracking_type"), p.as_posix())
        if key in reviewed and reviewed[key] != pair:
            raise ValueError(f"Existing reviewed duplicates conflict: {p}")
        reviewed[key] = pair

    assigned = {}
    provenance = {}
    counts = Counter()
    emitted = []
    destinations = set()
    for p in originals:
        original = read_obj(p)
        if "name_ru" in original or "tracking_type" in original:
            raise ValueError(f"Input unexpectedly enriched: {p}")
        rel = p.relative_to(SOURCE)
        key = identity(original)
        if key in assigned:
            ru, kind = assigned[key]
        elif key in reviewed:
            ru, kind = reviewed[key]
            assigned[key] = (ru, kind)
            provenance[key] = "existing_reviewed"
        else:
            manual_pair = manual.get(rel.as_posix())
            if manual_pair is None:
                manual_pair = manual.get(original["name"])
            if manual_pair is not None:
                ru, kind = manual_pair
                provenance[key] = "editorial"
            elif p.name in ref_types and normalize(original["name"]) in reference:
                ru = reference[normalize(original["name"])]
                kind = ref_types[p.name]
                provenance[key] = "reference_exact"
            else:
                raise ValueError(f"Missing explicitly reviewed translation/type: {rel} ({original['name']})")
            ru, kind = validate_pair(ru, kind, rel.as_posix())
            assigned[key] = (ru, kind)

        enriched = dict(original)
        enriched["name_ru"] = ru
        enriched["tracking_type"] = kind
        if set(enriched) != set(original) | {"name_ru", "tracking_type"}:
            raise AssertionError(f"Unexpected keys: {rel}")
        for field, value in original.items():
            if type(enriched[field]) is not type(value) or enriched[field] != value:
                raise AssertionError(f"Original field changed: {rel} -> {field}")
        if rel in destinations:
            raise AssertionError(f"Duplicate path: {rel}")
        destinations.add(rel)
        dest = TARGET / rel
        if dest in old_paths:
            if read_obj(dest) != enriched:
                raise ValueError(f"Existing reviewed copy differs; manual resolution required: {rel}")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            content = json.dumps(enriched, ensure_ascii=False, indent=2) + "\n"
            dest.write_text(content, encoding="utf-8")
            if rel.parts[0] == category:
                emitted.append({"path": dest.relative_to(ROOT).as_posix(), "content": content})
        counts[kind] += 1

    generated = set(TARGET.glob("*/*.json"))
    if generated != {TARGET / p.relative_to(SOURCE) for p in originals}:
        raise AssertionError("Work and source path sets differ")
    if len(assigned) != 1173:
        raise AssertionError(f"Unexpected distinct exercise identities: {len(assigned)}")
    prov = dict(Counter(provenance.values()))
    if prov != {"existing_reviewed": 177, "reference_exact": 167, "editorial": 829}:
        raise AssertionError(f"Unreviewed source or changed mapping: {prov}")

    for src in originals:
        orig = read_obj(src)
        dst = read_obj(TARGET / src.relative_to(SOURCE))
        if set(dst) != set(orig) | {"name_ru", "tracking_type"}:
            raise AssertionError(f"Bad fields: {src}")
        for k, v in orig.items():
            if k not in dst or type(dst[k]) is not type(v) or dst[k] != v:
                raise AssertionError(f"Original field mismatch: {src} -> {k}")

    report = {
        "source_json_count": len(originals),
        "work_json_count": len(generated),
        "unique_exercises": len(assigned),
        "existing_reviewed_unique": prov["existing_reviewed"],
        "reference_exact_unique": prov["reference_exact"],
        "editorial_unique": prov["editorial"],
        "new_work_files": len(generated) - len(old_paths),
        "tracking_type_counts": {k: counts.get(k, 0) for k in sorted(VALID_TYPES)},
        "original_fields_identical": True,
        "review_cases": REVIEW_CASES,
        "review_case_count": len(REVIEW_CASES),
    }
    print("MEZFIT_REPORT=" + json.dumps(report, ensure_ascii=False))
    print("MEZFIT_CATEGORY=" + category + ";EMITTED=" + str(len(emitted)))
    for item in emitted:
        print("MEZFIT_WORK_RECORD=" + json.dumps(item, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", required=True, choices=MANUAL_CATEGORIES)
    build(parser.parse_args().category)
