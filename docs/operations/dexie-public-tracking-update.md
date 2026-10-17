# Operator guide — tracking_type update for the existing public catalogue

This is a **data-only, manual publication**. It adds `tracking_type` to the
existing 1,324 public exercises in Dexie Cloud, preserving stable IDs, names,
anatomy, media references, taxonomy, realm access and existing personal copies.
Ordinary app users still cannot edit the public catalogue.

## Credentials and boundaries

Reuse the existing `dexie-production` GitHub Environment (required reviewer,
`main` only) and its **environment** secret `DEXIE_CLOUD_WRITE_KEY`. Preview
uses the existing independent read-only repository secret
`DEXIE_CLOUD_KEY_JSON`. The existing `CLOUDFLARE_API_TOKEN` reads/writes
private R2 source and backups. Do not generate new service keys, add privileges,
expose secrets, edit Dexie Cloud roles, or run this workflow from PR/push.

The new operations live in the existing GitHub Action
**Publish Dexie public exercise catalogue**. The older `preview` and
`publish` options still perform **initial v2.0 publication**, unchanged.

## Why the version is recorded separately

The original v2.0 catalogue is an immutable, content-addressed R2 object:

`exercise-catalogue/source/2.0.0/sha256-5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c.json`

The reviewed `restore-legacy-tracking.mjs` derives exactly 1,324 records,
of which 29 have `time_distance` and 1,295 have `weight_reps`.
It verifies the input digest and emits a new immutable v2.1 source with SHA-256:

`ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66`

The original `sourceSha256` of every Dexie row remains unchanged because it
identifies the original approved exercise/media dataset and is used by old
clients to decide whether all catalogue rows are available. The top-level
`schemaVersion: '2.0.0'` in the publication manifest also remains unchanged
so older deployed clients do not reject the catalogue. **This is intentional
backwards compatibility, not pretending that the v2.1 JSON has the old hash.**
The activated manifest gains:

- `trackingSchemaVersion: '2.1.0'`
- `trackingReleaseSha256: 'ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66'`

New clients validate all 1,324 tracking types once the marker is present.

## Publication checklist

1. Confirm `main` has the reviewed publisher change and that CI is green.
   Ask the database manager to verify the three public Dexie tables, primary
   key `id`, roles, and public-readonly access. Suspend unrelated privileged
   writes during the publication window.
2. Open GitHub Actions → **Publish Dexie public exercise catalogue**.
   Select `tracking-preview` and run from `main`. It reads the original R2
   JSON, checks both source digests, fetches the 1,324/69/1 public rows with
   the read-only account, checks the exact original catalogue and reports
   how many records still need `tracking_type`. It writes nothing.
3. Inspect the preview. Any changed ID, other field, unexpected row/realm,
   conflicting `tracking_type` or noncanonical manifest is a **hard stop**.
   No automatic deletion, private-row modification or generic overwrite is
   permitted. Reconcile the conflicting state in a separate reviewed change.
4. Select `tracking-publish`, enter exactly `UPDATE_TRACKING_1324_V21`,
   start it from `main` as the repository owner and approve the
   `dexie-production` environment deployment.
5. The workflow fetches the pinned original, derives the v2.1 source,
   performs a read-only preflight, and exports the current three public
   tables using the publication account. It saves a private backup in R2 at
   `exercise-catalogue/backups/<run-id>-<attempt>/before-tracking.json`.
   **No Dexie write occurs if this backup upload fails.**
6. After the backup, the verified v2.1 JSON is uploaded to its separate,
   content-addressed private R2 key:
   `exercise-catalogue/source/2.1.0/sha256-ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66.json`.
   The original v2.0 source is never modified.
7. The publisher updates **only** missing `tracking_type` fields in public
   exercise definitions, in batches of 25. It does not change IDs,
   `sourceSha256`, `realmId`, `owner`, taxonomy, other exercise fields,
   or permissions. It reads back and verifies every canonical field and
   every tracking value before activating the manifest marker.
8. Read the final workflow result, then rerun the existing read-only
   diagnostic `/dexie-public diagnose` on GitHub Issue #413; counts remain
   1,324 exercises / 69 taxonomy / 1 manifest. Verify the marker, selected
   `weight_reps` and `time_distance` examples, and GIF rendering in the
   deployed Telegram Mini App after Dexie Cloud sync.

## Partial failures, retries and recovery

While batches are running, the old publication manifest and source hashes
stay active. Older clients continue accepting the catalogue; the new
`tracking_type` values may gradually appear, but the new manifest marker
is not written until all 1,324 records have been verified. This means
**the release is not atomic across all exercise fields**; the publication
marker is the activation boundary.

If a batch fails, the marker remains unchanged. The next preview shows
remaining records; run `tracking-publish` again only after reviewing the
failure and confirming the protected backup. Rows that already have the
exact expected `tracking_type` are skipped, never overwritten. If the
marker was activated but readback or client sync fails, do not blindly
re-run a write or restore an entire production realm: first use the
private backup and a read-only diagnosis to plan a narrowly scoped,
reviewed corrective operation. No automatic rollback/delete is provided.

If a reader reports `incomplete`, inspect the manifest and all synced
public definitions. Do not change ordinary user permissions or delete
public records to force the UI to refresh.

The full release's values reproduce the historical D1 *import rule*;
they are not a direct read of the current legacy D1 table. An authorized
read-only legacy D1 comparison may be performed if exact live D1 values
must be confirmed before starting `tracking-publish`.
