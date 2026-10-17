# Protected publication of the public exercise catalogue

This manual-only process publishes schema 2.0.0 (1324 exercises and 69 taxonomy nodes) into `rlm-public` of the existing Dexie Cloud database. No production data is published by merging a PR.

For the subsequent **data-only tracking_type update** of an already-published catalogue, use the separate `tracking-preview` / `tracking-publish` operations documented in [dexie-public-tracking-update.md](./dexie-public-tracking-update.md). The original `preview` and `publish` options remain limited to the initial v2.0 release.

## Setup required before using the publish action

1. The database manager must review and separately back up the remote Dexie schema and role permissions. Confirm all three public catalogue tables use the `id` key, and ordinary coach/client accounts cannot write public data. This must happen using the manager account, not the workflow.
2. Create a *separate* publication service account with scopes `ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE`. Keep the existing `ACCESS_DB,GLOBAL_READ` diagnostics account unchanged.
3. In GitHub repository **Settings → Environments**, create `dexie-production`; configure required reviewers, restrict deployments to `main`, and prohibit protection bypass. If these controls are unavailable, **do not publish**.
4. Set environment secret `DEXIE_CLOUD_WRITE_KEY` to the complete JSON from the publication account's key file. Never put this write key in a repository secret. The existing `DEXIE_CLOUD_KEY_JSON` remains a repository-level read-only secret.
5. Confirm `CLOUDFLARE_API_TOKEN` permits remote reads and private R2 backup writes in bucket `mezfit`. Keep the source object and backups private. Prevent unrelated administrator changes during publication.

The GitHub workflow's `environment:` declaration alone does not configure reviewers. Check the Environment settings manually before executing any publication.

## Publication

In GitHub Actions, open **Publish Dexie public exercise catalogue** (default branch `main`).

First choose `preview`. It loads the immutable source from private R2, checks SHA-256, authenticates with read-only scopes, and reports counts plus missing records without writing.

For publication, select `publish`, enter `PUBLISH_1324_69_V2`, and approve the protected environment deployment. The workflow will:

1. Retrieve the source JSON at `exercise-catalogue/source/2.0.0/sha256-5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c.json` and validate its SHA-256.
2. Read only the three public catalogue tables; reject conflicting existing data, unknown IDs, unexpected manifests or invalid realms.
3. Upload a **private** backup of those public rows to R2 at `exercise-catalogue/backups/<run-id>-<attempt>/before-public.json` before any write. Never expose raw records in public logs or artifacts.
4. Insert missing exercises and taxonomy in batches, without deleting or overwriting different existing records.
5. Read back and verify all 1324 exercises and 69 taxonomy rows against the canonical content.
6. Only after successful verification, create the publication manifest and verify it by reading it back.

A failed run before the manifest step leaves only unactivated staged rows; reruns may resume if all existing rows match. No automatic deletions or schema/role changes are included. A previous manifest with a different source is a hard stop.

After publication rerun read-only diagnostics via the normal issue command `/dexie-public diagnose` on Issue #413. The expected counts are 1324 / 69 / 1.

## Boundaries

The publication key is database-wide; GitHub Environment approval, manual confirmation and reviewed restricted code are essential safeguards. Do not add this key to the app, Worker, ordinary repository secrets, or automatic push workflows. No GIF/R2 media routing is implemented by this workflow. Server schema and access rules must be checked independently by the manager.

See `docs/architecture/public-exercise-catalogue-pr1.md` and `docs/operations/dexie-public-catalogue-diagnostics.md`.
