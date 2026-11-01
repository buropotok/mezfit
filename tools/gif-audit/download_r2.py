#!/usr/bin/env python3
"""Download the pinned R2 GIF object set without changing any cloud data."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
APPROVED = ROOT / "shared/approved-exercise-media.json"
INVENTORY = ROOT / "audit/visual/audit_execution_plan.json"
DEST = ROOT / "audit/gif-sources/r2"
BUCKET = "mezfit"
EXPECTED = 1324
MAX_BYTES = 8 * 1024 * 1024
WRANGLER = ROOT / "node_modules/.bin/wrangler"


def approved_keys() -> tuple[str, list[str]]:
    revision = json.loads(APPROVED.read_text(encoding="utf-8"))["datasetGitRevision"]
    if re.fullmatch(r"[a-f0-9]{40}", revision) is None:
        raise ValueError("Pinned media revision is invalid")
    plan = json.loads(INVENTORY.read_text(encoding="utf-8"))
    ids = [str(value) for stage in plan["stages"] for value in stage["exercise_ids"]]
    if plan["total_exercises"] != EXPECTED or len(ids) != EXPECTED:
        raise ValueError("Unexpected R2 media inventory count")
    if len(set(ids)) != EXPECTED or any(re.fullmatch(r"[0-9]{4}", x) is None for x in ids):
        raise ValueError("Duplicate or malformed R2 media key")
    return revision, sorted(ids)


def validate_gif(path: Path) -> dict[str, object]:
    size = path.stat().st_size
    if not 10 <= size <= MAX_BYTES:
        raise ValueError(f"Bad GIF length: {path.name}")
    with Image.open(path) as img:
        if img.format != "GIF" or img.n_frames < 1 or any(n <= 0 or n > 4096 for n in img.size):
            raise ValueError(f"Invalid GIF: {path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"name": path.name, "size": size, "sha256": digest.hexdigest()}


def get_one(revision: str, gif_id: str) -> None:
    target = DEST / f"{gif_id}.gif"
    if target.is_file():
        validate_gif(target)
        return
    key = f"{BUCKET}/exercise-media/github_exercises_dataset/versions/{revision}/{gif_id}.gif"
    temporary = DEST / f".{gif_id}.gif.part"
    for attempt in range(3):
        try:
            result = subprocess.run(
                [str(WRANGLER), "r2", "object", "get", key, "--file", str(temporary), "--remote"],
                cwd=ROOT, capture_output=True, text=True, timeout=180, check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(f"R2 get failed for {gif_id} (exit {result.returncode})")
            validate_gif(temporary)
            os.replace(temporary, target)
            return
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise


def verify_snapshot(revision: str, ids: list[str], *, write_manifest: bool) -> None:
    expected = {f"{x}.gif" for x in ids}
    available = {p.name for p in DEST.glob("*.gif") if p.is_file()}
    if expected != available:
        raise ValueError(f"R2 snapshot incomplete: missing={len(expected - available)}, extra={len(available - expected)}")
    rows = [validate_gif(DEST / name) for name in sorted(expected)]
    manifest = {
        "source": "r2",
        "bucket": BUCKET,
        "prefix": f"exercise-media/github_exercises_dataset/versions/{revision}/",
        "revision": revision,
        "count": len(rows),
        "files": rows,
    }
    path = DEST / "manifest.json"
    if write_manifest:
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    elif not path.is_file() or json.loads(path.read_text(encoding="utf-8")) != manifest:
        raise ValueError("R2 snapshot manifest is absent or does not match the downloaded files")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["download", "verify"])
    args = parser.parse_args()
    revision, ids = approved_keys()
    if args.operation == "download":
        if not WRANGLER.is_file() or not os.environ.get("CLOUDFLARE_API_TOKEN"):
            raise RuntimeError("Wrangler and a Cloudflare token are required for download")
        DEST.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            jobs = {pool.submit(get_one, revision, value): value for value in ids}
            failures = []
            for job in as_completed(jobs):
                try:
                    job.result()
                except Exception:
                    failures.append(jobs[job])
            if failures:
                raise RuntimeError(f"R2 download incomplete; failed object IDs: {', '.join(sorted(failures))}")
    verify_snapshot(revision, ids, write_manifest=args.operation == "download")
    print(f"Verified permanent R2 GIF snapshot: {len(ids)} files, revision {revision}")


if __name__ == "__main__":
    main()
