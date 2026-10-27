#!/usr/bin/env python3
"""Download exercise GIFs into flat assets/media and set image_id in JSON.

The catalogue preflight rejects conflicting source URLs with the same filename.
It never invents filenames or silently overwrites different media.
"""
import argparse
import hashlib
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "assets" / "exercises"
MEDIA = ROOT / "assets" / "media"
CATEGORIES = (
    "neck", "trapezius", "shoulders", "chest", "back", "erector-spinae",
    "biceps", "triceps", "forearm", "abs", "leg", "calf", "hip",
    "cardio", "full-body",
)
HOST = "fitnessprogramer.com"
LIMIT = 50 * 1024 * 1024
_thread = threading.local()


def filename_for(url):
    if not isinstance(url, str) or not url:
        raise ValueError("GIF URL is missing")
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != HOST:
        raise ValueError(f"Unexpected GIF host or scheme: {url}")
    name = unquote(parts.path.rsplit("/", 1)[-1])
    if (not name or name in (".", "..") or "/" in name or "\\" in name
            or any(ord(c) < 32 for c in name)
            or len(name.encode("utf-8")) > 240
            or not name.lower().endswith(".gif")):
        raise ValueError(f"Unsafe GIF filename {name!r} from {url}")
    return name


def catalogue():
    groups, urls, folded = {}, {}, {}
    for cat in CATEGORIES:
        folder = CATALOGUE / cat
        if not folder.is_dir():
            raise RuntimeError(f"Category folder missing: {cat}")
        records = {}
        for path in sorted(folder.glob("*.json")):
            if path.name == "_manifest.json":
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not data.get("name"):
                raise RuntimeError(f"Invalid exercise name: {path}")
            url = data.get("gif_url")
            name = filename_for(url)
            folded_name = name.casefold()
            if folded_name in folded and folded[folded_name] != name:
                raise RuntimeError(f"Case-insensitive name conflict: {folded[folded_name]} / {name}")
            folded[folded_name] = name
            if name in urls and urls[name] != url:
                raise RuntimeError(
                    f"Different URLs share original GIF filename {name}: "
                    f"{urls[name]} / {url}")
            urls[name] = url
            if "image_id" in data and data["image_id"] != name:
                raise RuntimeError(f"Existing image_id does not match GIF: {path}")
            records[path] = (data, name)
        groups[cat] = records
    return groups, urls


def session_for_thread():
    if not hasattr(_thread, "session"):
        s = requests.Session()
        retry = Retry(total=5, status=5, connect=5, read=5,
                      status_forcelist=(429, 500, 502, 503, 504), backoff_factor=1.5)
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (compatible; MezfitExerciseMediaImport/1.0)",
            "Accept": "image/gif,image/*;q=0.7,*/*;q=0.3",
        })
        _thread.session = s
    return _thread.session


def inspect_gif(path):
    length = 0
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        header = stream.read(6)
        if header not in (b"GIF87a", b"GIF89a"):
            raise RuntimeError(f"Source response is not a GIF: {path.name}")
        sha.update(header)
        length += len(header)
        while True:
            chunk = stream.read(256 * 1024)
            if not chunk:
                break
            length += len(chunk)
            if length > LIMIT:
                raise RuntimeError(f"GIF exceeds 50 MiB: {path.name}")
            sha.update(chunk)
    if length < 14:
        raise RuntimeError(f"Truncated GIF: {path.name}")
    return sha.hexdigest(), length


def download(name, url):
    output = MEDIA / name
    if output.is_file():
        return name, inspect_gif(output), False
    temporary = MEDIA / (name + ".part")
    try:
        with session_for_thread().get(url, stream=True, timeout=(20, 70)) as response:
            response.raise_for_status()
            final = urlsplit(response.url)
            if final.scheme != "https" or final.hostname != HOST:
                raise RuntimeError(f"Source redirected to unexpected host: {response.url}")
            total = 0
            with temporary.open("wb") as dest:
                for part in response.iter_content(128 * 1024):
                    if part:
                        total += len(part)
                        if total > LIMIT:
                            raise RuntimeError(f"GIF exceeds 50 MiB: {name}")
                        dest.write(part)
        validated = inspect_gif(temporary)
        os.replace(temporary, output)
        return name, validated, True
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("category", choices=(*CATEGORIES, "preflight"))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 8:
        parser.error("--workers must be between 1 and 8")
    groups, urls = catalogue()
    print(json.dumps({
        "total_records": sum(len(group) for group in groups.values()),
        "unique_original_filenames": len(urls),
        "categories": {key: len(value) for key, value in groups.items()},
    }), flush=True)
    if args.category == "preflight":
        return
    records = groups[args.category]
    if not records:
        raise RuntimeError(f"Empty category {args.category}")
    to_get = {name: urls[name] for _, name in records.values()}
    MEDIA.mkdir(parents=True, exist_ok=True)
    results = {}
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        tasks = {executor.submit(download, name, url): name
                 for name, url in to_get.items()}
        for i, task in enumerate(as_completed(tasks), 1):
            name = tasks[task]
            results[name] = task.result()
            if i % 10 == 0 or i == len(tasks):
                print(f"{args.category}: verified {i}/{len(tasks)} GIFs", flush=True)
    if set(results) != set(to_get):
        raise RuntimeError(f"Incomplete GIF downloads for {args.category}")
    for path, (doc, name) in records.items():
        doc["image_id"] = name
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(json.dumps({
        "category": args.category,
        "records": len(records),
        "unique_files": len(to_get),
        "downloaded": sum(1 for v in results.values() if v[2]),
        "status": "complete",
    }), flush=True)


if __name__ == "__main__":
    main()
