"""Publish the pinned FitnessProgramer GIFs and static list previews."""

import hashlib
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from io import BytesIO
from itertools import islice
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image, ImageOps


PREFIX = "exercises/base2/v1/"
YANDEX = "https://storage.yandexcloud.net/mezfit-comm-poc-20261106/"
CF_API = "https://api.cloudflare.com/client/v4/"
cf_rate_lock = Lock()
cf_next_request = 0.0


def pace_cloudflare():
    # The management API allows 1200 requests per five minutes per user.
    global cf_next_request
    with cf_rate_lock:
        delay = max(0.0, cf_next_request - time.monotonic())
        cf_next_request = time.monotonic() + delay + 0.34
    time.sleep(delay)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(method, url, headers, body=None, allowed=()):
    for attempt in range(7):
        if url.startswith(CF_API):
            pace_cloudflare()
        try:
            req = Request(url, method=method, data=body, headers=headers)
            with build_opener(NoRedirect()).open(req, timeout=45) as response:
                return response.status, response.read(), response.headers
        except HTTPError as error:
            with error:
                if error.code in allowed:
                    return error.code, error.read(), error.headers
                if error.code not in {408, 429, 500, 502, 503, 504} or attempt == 6:
                    raise RuntimeError(f"{method} {url} returned HTTP {error.code}") from None
                retry_after = error.headers.get("Retry-After", "")
                delay = int(retry_after) if retry_after.isdigit() else 0
        except (OSError, IncompleteRead):
            if attempt == 6:
                raise RuntimeError(f"{method} {url} network failure") from None
            delay = 0
        time.sleep(max(delay, 2 ** attempt))


def make_preview(data):
    with Image.open(BytesIO(data)) as image:
        image.seek(0)
        frame = ImageOps.contain(image.convert("RGBA"), (120, 120), Image.Resampling.LANCZOS)
        output = BytesIO()
        frame.save(output, format="WEBP", quality=76, method=6, exact=True)
        return output.getvalue()


def publish_file(key, data, mime, r2_base, cf_auth, yc_auth, origin):
    r2_url = r2_base + key
    yc_url = YANDEX + key
    metadata = {"Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable"}
    # Unconditional retries after a timed-out PUT send the same immutable bytes.
    status, stored, _ = request("GET", r2_url, cf_auth, allowed=(404,))
    if status == 404:
        request("PUT", r2_url, {**cf_auth, **metadata}, data)
        _, stored, _ = request("GET", r2_url, cf_auth)
    if stored != data:
        raise RuntimeError(f"R2 content mismatch for {key}")
    # Conditional creation also works for accounts without list-bucket access.
    request("PUT", yc_url, {**yc_auth, **metadata, "If-None-Match": "*"}, data, allowed=(412,))
    _, stored, headers = request("GET", yc_url, {"Origin": origin})
    if stored != data or headers.get_content_type() != mime:
        raise RuntimeError(f"Yandex public readback mismatch for {key}")
    if headers.get("Access-Control-Allow-Origin") not in {origin, "*"}:
        raise RuntimeError(f"Yandex CORS does not allow the Mini App to read {key}")


def main():
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    origin = os.environ["MEZFIT_APP_ORIGIN"].rstrip("/")
    if not re.fullmatch("[a-fA-F0-9]{32}", account_id) or not re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]+)?", origin):
        raise ValueError("Invalid account ID or Mini App origin")
    r2_base = f"{CF_API}accounts/{account_id}/r2/buckets/mezfit/objects/"
    cf_auth = {"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]}
    yc_auth = {"Authorization": "Bearer " + os.environ["YC_IAM_TOKEN"]}
    paths = sorted(Path("assets/media").glob("*.gif"))
    by_digest = {hashlib.sha256(path.read_bytes()).hexdigest(): path for path in paths}
    if len(paths) != 1168 or len(by_digest) != 1167:
        raise RuntimeError("Incomplete Base 2 release")

    def publish(entry):
        digest, path = entry
        gif = path.read_bytes()
        for ext, data in (("gif", gif), ("webp", make_preview(gif))):
            publish_file(f"{PREFIX}{digest}.{ext}", data, "image/" + ext, r2_base, cf_auth, yc_auth, origin)

    # Each mirror is independently recoverable. Wait for the first pair to
    # verify credentials, public GET and CORS before scheduling the rest.
    entries = iter(by_digest.items())
    publish(next(entries))
    with ThreadPoolExecutor(max_workers=3) as pool:
        # Stop scheduling new work if a provider reports a permanent failure.
        while batch := list(islice(entries, 24)):
            list(pool.map(publish, batch))
            print(f"Verified through {batch[-1][1].name}", flush=True)
    print("Verified 1167 GIFs and 1167 WebP previews in each bucket.")


if __name__ == "__main__":
    main()
