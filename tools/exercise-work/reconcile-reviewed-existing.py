#!/usr/bin/env python3
"""One-time, non-destructive reconciliation of already reviewed exercise copies.

Never translates or classifies additional exercises. Every original field is
reloaded from the *current* assets/exercises tree; two reviewed fields survive.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "exercises"
WORK = ROOT / "assets" / "work"
VALID = {"weight_reps", "time", "time_distance", "time_reps", "time_weight"}


def main():
    existing = sorted(WORK.glob("*/*.json"))
    if not existing:
        raise RuntimeError("No existing reviewed work JSON files found")
    pending = []
    reviewed = {}
    for dst in existing:
        rel = dst.relative_to(WORK)
        src = SOURCE / rel
        if not src.is_file():
            raise ValueError(f"Work file lacks source: {rel}")
        original = json.loads(src.read_text(encoding="utf-8"))
        old = json.loads(dst.read_text(encoding="utf-8"))
        if not isinstance(original, dict) or not isinstance(old, dict):
            raise ValueError(f"Not an object: {rel}")
        if old.get("name") != original.get("name") or old.get("source_url") != original.get("source_url"):
            raise ValueError(f"Exercise identity differs; requires editorial review: {rel}")
        ru = old.get("name_ru")
        kind = old.get("tracking_type")
        if not isinstance(ru, str) or not ru.strip() or kind not in VALID:
            raise ValueError(f"Missing/invalid reviewed fields: {rel}")
        key = original.get("source_url") or original["name"].strip().casefold()
        pair = (ru, kind)
        if key in reviewed and reviewed[key] != pair:
            raise ValueError(f"Inconsistent translations or tracking of duplicates: {rel}")
        reviewed[key] = pair
        if "name_ru" in original or "tracking_type" in original:
            raise ValueError(f"Source already enriched unexpectedly: {rel}")
        enriched = dict(original)
        enriched["name_ru"] = ru
        enriched["tracking_type"] = kind
        if set(enriched) - set(original) != {"name_ru", "tracking_type"}:
            raise AssertionError(f"Wrong enrichment keys: {rel}")
        if any(enriched[k] != v or type(enriched[k]) is not type(v) for k, v in original.items()):
            raise AssertionError(f"Original fields altered: {rel}")
        if old != enriched:
            pending.append((dst, enriched))

    for dst, enriched in pending:
        dst.write_text(json.dumps(enriched, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for dst in existing:
        src = SOURCE / dst.relative_to(WORK)
        original = json.loads(src.read_text(encoding="utf-8"))
        enriched = json.loads(dst.read_text(encoding="utf-8"))
        if set(enriched) - set(original) != {"name_ru", "tracking_type"}:
            raise AssertionError(f"Incorrect work keys: {dst}")
        for key, value in original.items():
            if key not in enriched or type(enriched[key]) is not type(value) or enriched[key] != value:
                raise AssertionError(f"Source field mismatch: {dst} -> {key}")

    print(f"Reviewed work files: {len(existing)}; repaired source copies: {len(pending)}; unique identities: {len(reviewed)}")


if __name__ == "__main__":
    main()
