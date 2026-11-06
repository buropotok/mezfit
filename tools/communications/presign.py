"""Operator-only signing. Requires boto3 in the operator environment, never in a WebView."""
import argparse
import json
import os
from pathlib import Path
import sys
import uuid

BUCKET = "mezfit-comm-poc-20261106"


def main():
    parser = argparse.ArgumentParser(description="Create short-lived COMM-02 capabilities; no cloud resources are created.")
    parser.add_argument("--kind", choices=("small", "video"), required=True)
    parser.add_argument("--output", required=True, help="Private local output outside the repository")
    args = parser.parse_args()
    output_path = Path(args.output).resolve()
    repository = Path(__file__).resolve().parents[2]
    if output_path == repository or repository in output_path.parents:
        raise ValueError("OUTPUT_MUST_BE_OUTSIDE_REPOSITORY")
    if not os.environ.get("AWS_ACCESS_KEY_ID") or not os.environ.get("AWS_SECRET_ACCESS_KEY"):
        raise ValueError("MISSING_OPERATOR_CREDENTIALS")
    import boto3  # Official SDK; dependency belongs to the approved operator environment.
    from botocore.config import Config
    s3 = boto3.client("s3", endpoint_url="https://storage.yandexcloud.net", region_name="ru-central1",
                      aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
                      config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                                    request_checksum_calculation="when_required", response_checksum_validation="when_required"))
    suffix = "bin" if args.kind == "small" else "mp4"
    key = "comm02/" + uuid.uuid4().hex + "." + suffix
    ticket = {
        method.lower(): s3.generate_presigned_url(operation, Params={"Bucket": BUCKET, "Key": key},
                                                  ExpiresIn=900, HttpMethod=method)
        for method, operation in (("PUT", "put_object"), ("GET", "get_object"), ("HEAD", "head_object"))
    }
    # Exclusive creation prevents accidental overwrite/symlink traversal; URLs never reach stdout.
    fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(ticket, output)
    print("COMM02_TICKET_WRITTEN; expires in 900 seconds; do not commit or post this file")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # SDK exceptions can contain URLs/credentials; never print their raw representation.
        print("COMM02_SIGNING_FAILED: check private operator configuration", file=sys.stderr)
        sys.exit(1)
