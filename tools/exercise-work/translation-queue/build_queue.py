#!/usr/bin/env python3
"""Deterministic exercise translation queue builder (no app runtime dependencies).

Read every assets/work/*/*.json from an immutable source snapshot. Group identical
nonempty how_to values by SHA-256 and allocate whole groups to capacity-limited
batches. Existing Russian translations are kept and counted, never regenerated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path("tools/exercise-work/translation-queue")
WORK = Path("assets/work")
EXPECTED_FILES = 1673
BATCH_SIZE = 100


def sha256(text: bytes) -> str:
    return hashlib.sha256(text).hexdigest()


def git_tree(ref: str) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", f"{ref}:assets/work"], text=True
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    source_commit = args.source_commit

    # Fail closed if the queue would silently mix repository versions.
    assert git_tree(source_commit) == git_tree("HEAD"), (
        "assets/work differs from the frozen main source_commit"
    )

    paths = sorted(WORK.glob("*/*.json"))
    assert len(paths) == EXPECTED_FILES, (
        f"Expected {EXPECTED_FILES} work JSONs, got {len(paths)}"
    )
    assert len(set(paths)) == len(paths)

    groups: dict[str, dict] = {}
    empties: list[str] = []
    existing_translated_paths: set[str] = set()
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        rel = path.as_posix()
        english = data.get("how_to", "")
        assert isinstance(english, str), f"Invalid how_to type: {rel}"
        ru = data.get("how_to_ru")
        if "how_to_ru" in data:
            assert isinstance(ru, str) and ru.strip(), (
                f"Invalid existing how_to_ru: {rel}"
            )
            assert english.strip(), (
                f"Translation without English source: {rel}"
            )
            existing_translated_paths.add(rel)

        if not english.strip():
            empties.append(rel)
            continue

        digest = sha256(english.encode("utf-8"))
        if digest not in groups:
            groups[digest] = {
                "english": english,
                "files": [],
                "ru_values": set(),
                "pretranslated": 0,
            }
        group = groups[digest]
        assert group["english"] == english, (
            f"SHA collision for {rel}"
        )
        group["files"].append(rel)
        if ru:
            group["ru_values"].add(ru)
            group["pretranslated"] += 1

    conflicts = {
        digest: sorted(group["files"])
        for digest, group in groups.items()
        if len(group["ru_values"]) > 1
    }
    assert not conflicts, (
        f"Conflicting existing Russian translations: {conflicts}"
    )

    expected_nonempty = sum(len(group["files"]) for group in groups.values())
    assert len(paths) == expected_nonempty + len(empties)
    # Explicit inventory guards from the existing, reviewed translation work.
    assert expected_nonempty == 963, expected_nonempty
    assert len(empties) == 710, len(empties)
    assert len(groups) == 652, len(groups)

    batch_count = (len(paths) + BATCH_SIZE - 1) // BATCH_SIZE
    capacities = [BATCH_SIZE] * batch_count
    capacities[-1] = len(paths) - BATCH_SIZE * (batch_count - 1)
    assert capacities == [100] * 16 + [73]

    bins = [
        {
            "id": f"B{i + 1:03d}",
            "capacity": capacity,
            "files": [],
            "load": 0,
            "english_file_count": 0,
            "unique_instruction_count": 0,
            "existing_translated_count": 0,
            "new_translation_count": 0,
            "instruction_hashes": [],
        }
        for i, capacity in enumerate(capacities)
    ]

    # Long untranslated instructions are the most expensive. Place them first,
    # but never split an exact-source group across different batches.
    ordered = sorted(
        groups.items(),
        key=lambda item: (
            -(len(item[1]["english"]) if not item[1]["ru_values"] else 0),
            -len(item[1]["files"]),
            item[0],
        ),
    )
    owners = {}
    for digest, group in ordered:
        group_files = sorted(group["files"])
        assert len(group_files) <= BATCH_SIZE, digest
        eligible = [
            b for b in bins
            if len(b["files"]) + len(group_files) <= b["capacity"]
        ]
        assert eligible, (
            "Cannot pack instruction group without exceeding batch capacity"
        )
        selected = min(
            eligible,
            key=lambda b: (
                b["load"] / b["capacity"],
                b["load"],
                b["english_file_count"],
                b["id"],
            ),
        )
        for path in group_files:
            assert path not in owners
            owners[path] = selected["id"]
        selected["files"].extend(group_files)
        selected["english_file_count"] += len(group_files)
        selected["unique_instruction_count"] += 1
        selected["existing_translated_count"] += group["pretranslated"]
        selected["new_translation_count"] += int(not group["ru_values"])
        selected["instruction_hashes"].append(digest)
        if not group["ru_values"]:
            selected["load"] += len(group["english"])

    # There are 710 source records without an English instruction. Fill all
    # remaining slots with these individually; they need no translation.
    remaining_empties = iter(sorted(empties))
    for b in bins:
        need = b["capacity"] - len(b["files"])
        for _ in range(need):
            path = next(remaining_empties)
            assert path not in owners
            owners[path] = b["id"]
            b["files"].append(path)
    assert next(remaining_empties, None) is None, "Unassigned empty files"

    actual_paths = [path for b in bins for path in b["files"]]
    source_paths = [p.as_posix() for p in paths]
    assert len(actual_paths) == EXPECTED_FILES
    assert Counter(actual_paths) == Counter(source_paths)
    assert len(owners) == EXPECTED_FILES
    assert [len(b["files"]) for b in bins] == capacities
    for digest, group in groups.items():
        assert len({owners[p] for p in group["files"]}) == 1, (
            f"Exact English duplicate split between batches: {digest}"
        )
    assert sum(b["unique_instruction_count"] for b in bins) == len(groups)
    assert sum(b["existing_translated_count"] for b in bins) == len(existing_translated_paths)
    assert sum(b["new_translation_count"] for b in bins) == sum(
        1 for g in groups.values() if not g["ru_values"]
    )

    manifest = {
        "schema_version": 1,
        "source_commit": source_commit,
        "batch_size": BATCH_SIZE,
        "total_files": len(paths),
        "nonempty_how_to_files": expected_nonempty,
        "empty_how_to_files": len(empties),
        "unique_nonempty_how_to": len(groups),
        "existing_how_to_ru_files": len(existing_translated_paths),
        "new_unique_translations_required": sum(
            1 for g in groups.values() if not g["ru_values"]
        ),
        "grouping": "Exact UTF-8 how_to content; SHA-256; whole groups per batch",
        "batches": [
            {
                "id": b["id"],
                "files": sorted(b["files"]),
                "nonempty_how_to_files": b["english_file_count"],
                "empty_how_to_files": b["capacity"] - b["english_file_count"],
                "unique_nonempty_how_to": b["unique_instruction_count"],
                "existing_how_to_ru_files": b["existing_translated_count"],
                "new_unique_translations_required": b["new_translation_count"],
                "estimated_untranslated_english_chars": b["load"],
            }
            for b in bins
        ],
    }
    payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    statuses = {
        "schema_version": 1,
        "source_commit": source_commit,
        "manifest_sha256": sha256(payload.encode("utf-8")),
        "batches": {
            b["id"]: {
                "status": "new",
                "agent": None,
                "claim_id": None,
                "started_at": None,
                "lease_until": None,
                "completed_at": None,
                "result_branch": None,
                "result_commit": None,
                "result_stats": None,
            }
            for b in bins
        },
    }
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "batches.json").write_text(payload, encoding="utf-8")
    (ROOT / "status.json").write_text(
        json.dumps(statuses, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "source_commit": source_commit,
        "file_count": len(paths),
        "nonempty_how_to": expected_nonempty,
        "unique_nonempty": len(groups),
        "existing_how_to_ru": len(existing_translated_paths),
        "batches": len(bins),
        "sizes": [len(b["files"]) for b in bins],
        "source_group_duplicates_co_located": True,
        "manifest_sha256": statuses["manifest_sha256"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
