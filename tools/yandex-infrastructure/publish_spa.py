"""Owner-confirmed publication of dist/ to Yandex Object Storage using OIDC IAM.

Never deletes objects. Uploads index.html last so an HTML release cannot
reference files that have not been uploaded yet. Independent from CF deploy.
"""

import hashlib
import mimetypes
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen, build_opener

from web_hosting import NoRedirect, WebHostingError, bucket_name, inspect, request_json

STORAGE_OBJECTS = "https://storage.yandexcloud.net"
CONFIRM = "PUBLISH_MEZFIT_WEB"


def files_to_publish(directory):
    root = Path(directory)
    if not root.is_dir() or root.is_symlink() or not (root / "index.html").is_file():
        raise WebHostingError("Missing trusted dist/index.html; build the SPA first.")
    files = []
    for entry in root.rglob("*"):
        if entry.is_symlink():
            raise WebHostingError(f"Refusing symlink inside dist: {entry}")
        if entry.is_file():
            relative_path = entry.relative_to(root)
            name = relative_path.as_posix()
            # Vite copies empty public/.gitkeep placeholders into dist/.
            # Never upload them; non-empty or hidden-directory files stay forbidden.
            if (relative_path.name == ".gitkeep"
                    and all(not part.startswith(".") for part in relative_path.parts[:-1])):
                if entry.stat().st_size != 0:
                    raise WebHostingError(f"Refusing non-empty .gitkeep file: {name}")
                continue
            if name.startswith(".") or "/." in name or name.endswith(".map"):
                raise WebHostingError(f"Refusing hidden or source-map file: {name}")
            files.append((name, entry))
    if len(files) < 2:
        raise WebHostingError("Incomplete SPA build: index.html is the only dist object.")
    return sorted((file for file in files if file[0] != "index.html")) + [
        ("index.html", root / "index.html")
    ]


def headers_for(name):
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if name.endswith(".js") or name.endswith(".mjs"):
        content_type = "application/javascript"
    if name.endswith(".wasm"):
        content_type = "application/wasm"
    if name.endswith(".webmanifest"):
        content_type = "application/manifest+json"
    if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
        content_type += "; charset=utf-8"
    fingerprinted_asset = (name.startswith("assets/")
                           and re.search(r"[-.][a-zA-Z0-9_-]{8,}\.[^.]+$", name))
    return {
        "Content-Type": content_type,
        "Cache-Control": ("public, max-age=31536000, immutable" if fingerprinted_asset
                          else "no-store" if name == "index.html"
                          else "public, max-age=300"),
    }


def publish(directory, bucket, iam_token, upload):
    files = files_to_publish(directory)
    print(f"Publishing {len(files)} dist objects to bucket {bucket}; no deletions.")
    index_content = (Path(directory) / "index.html").read_bytes()
    if not index_content:
        raise WebHostingError("SPA index.html is unexpectedly empty.")
    for name, path in files:
        contents = path.read_bytes()
        upload(bucket, name, contents, headers_for(name))
    print(f"Published index.html SHA-256: {hashlib.sha256(index_content).hexdigest()}")


def main():
    folder = os.environ.get("YC_FOLDER_ID", "")
    token = os.environ.get("YC_IAM_TOKEN", "")
    if not re.fullmatch(r"[a-z0-9]+", folder) or not token:
        raise WebHostingError("Missing Yandex folder ID or short-lived IAM token.")
    if os.environ.get("CONFIRM") != CONFIRM:
        raise WebHostingError("Explicit publication confirmation missing.")

    opener = build_opener(NoRedirect())
    def api(url, label, payload=None):
        return request_json(opener, token, url, label, payload)
    bucket, gateway, certificate = inspect(api, folder)
    if not all((bucket, gateway, certificate)):
        raise WebHostingError("Hosting resources missing; run Prepare Yandex Web Hosting first.")

    def upload(bucket, key, body, headers):
        safe_key = quote(key, safe="/")
        request = Request(
            f"{STORAGE_OBJECTS}/{bucket}/{safe_key}",
            data=body, method="PUT",
            headers={**headers, "Authorization": f"Bearer {token}"},
        )
        try:
            with urlopen(request, timeout=120) as response:
                if response.status not in (200, 201):
                    raise WebHostingError(f"Object {key}: unexpected response {response.status}.")
        except HTTPError as error:
            raise WebHostingError(f"Object {key}: upload HTTP {error.code}; inspect bucket IAM.") from None
        except (URLError, OSError):
            raise WebHostingError(f"Object {key}: upload failed; re-run to overwrite safely.") from None

    publish("dist", bucket_name(folder), token, upload)


if __name__ == "__main__":
    try:
        main()
    except WebHostingError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
