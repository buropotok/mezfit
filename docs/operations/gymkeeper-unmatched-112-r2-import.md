# Manual import of 112 original Gym Keeper GIFs into private R2

## Purpose and boundaries

This workflow stores the **112 Gym Keeper exercise GIFs whose four-digit APK IDs
are not among the pinned 1324 Mezfit public catalogue IDs**. It does not create
or alter public exercise definitions, D1 indexes, programme snapshots, any
catalogue manifest, Worker routes, or media already served by Mezfit.

Source-of-truth references are:
- APK-derived SQL seeds `migrations/0007...` through `0013...`;
- reviewed staging list
  `audit/visual/input/gymkeeper_unmatched_112_gymvisual_metadata.json`;
- 1324 canonical IDs in `audit/visual/audit_execution_plan.json`.

The importer rejects an invalid entry, path injection, duplicate, mismatched APK
filename, ID collision, or any deviation from the exact 112-record difference.

## R2 storage

Existing private bucket: `mezfit`.

New **isolated object prefix** (R2 is object storage, so this is a logical folder):

```
exercise-media/gym_keeper_apk/unmatched-112/v1/<original APK reference key>
```

Example:
```
exercise-media/gym_keeper_apk/unmatched-112/v1/01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif
```

For each reference, GitHub Actions:
1. Downloads the original bytes from the approved **Gym Keeper APK URL**
   `https://47-1594.s.cdn13.com/img/gifs/180/<original APK reference key>`.
   No downloads from `gymvisual.com` occur.
2. Validates GIF87a/GIF89a signature, exact 180×180 frame dimensions and a
   maximum size of 8 MiB.
3. Checks the destination object; if already present, verifies exact SHA-256
   equality and skips. A different existing object is **never overwritten**.
4. Writes any missing object via Wrangler `r2 object put --remote`, reads it
   back via `r2 object get --remote`, and verifies identical SHA-256.
5. Writes only a summary and object hashes to GitHub Actions logs, not GIF
   bytes, credentials or tokens.

The importer deliberately does **not** copy from legacy
`exercise-media/gym_keeper_apk/<reference_key>` objects, because the old
importer could have populated them through approximate name matching. This
workflow uses exact URLs from the APK and checks their bytes before writing.

The importer treats authentication, network, and bucket errors as fatal rather
than treating them as a missing object. It may complete some entries before a
later failure; a rerun safely skips already verified entries.

No new R2 bucket, public access policy, GitHub media files or Cloudflare Worker
endpoint is created. This prefix is private: objects will **not automatically
appear in the Telegram Mini App**. Connecting it to the catalogue requires a
separate reviewed versioned catalogue/media mapping change.

## One-time GitHub setup

The owner must confirm the following before any upload:

1. The existing `CLOUDFLARE_API_TOKEN` repository secret must permit remote
   object reads/writes in the existing `mezfit` R2 bucket. Use least privilege
   where possible; never put credentials in source code or PR/push workflows.
2. Merge the reviewed workflow and staging data into `main`. A new
   `workflow_dispatch` workflow is normally available in the Actions UI only
   after the workflow exists on `main`.

No GitHub Environment, protected environment variable, or extra confirmation
phrase is required. Selecting `upload` and pressing **Run workflow** is the
user's explicit instruction to copy the 112 GIFs.

## Manual operation (nothing runs automatically)

Under GitHub **Actions → Import 112 Gym Keeper GIFs to private R2 → Run workflow**,
select the `main` branch:

1. Choose `preview` first. It requires no Cloudflare credential and checks all
   112 IDs/source paths and prints the destination plan; it does not contact R2.
2. Review the plan, select `upload`, then press **Run workflow**.
   The existing Cloudflare repository secret is used only in this upload job.
3. Inspect the Actions summary for uploaded/existing counts; there must be 112
   verified destination objects. A skipped object is only accepted when its
   SHA-256 matches the source.

The workflow refuses pushes, pull requests, non-`main` branches,
non-repository-owner dispatches. An upload cannot occur in `preview` mode.
No `DEXIE_CLOUD_WRITE_KEY` or privileged Dexie Cloud role is involved.

## Rights and attribution

The product owner confirmed permission to use these GIFs in Mezfit and approved
private R2 storage. The exercise GIF copyright remains with GymVisual:
**© Gym visual — https://gymvisual.com/**. Store and serve only the approved
180×180 GIFs and preserve this attribution in downstream catalogue metadata.

## Verification boundary

This workflow has a dedicated source-level test and is also covered by normal
PR checks. Do not execute a manual upload to validate an unmerged PR. The PR CI
runs npm installation, tests, typecheck and build; no local run is needed.
