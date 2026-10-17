# Exercise tracking v2.1.0 — prepared, not published

**Scope:** restore the missing `tracking_type` to the 1,324 existing public exercise
definitions without changing their stable four-character IDs, names, anatomy,
instructions, media references or private coach/client data.

## Source of values and limits of evidence

The active v2.0.0 public source is the private R2 object
`exercise-catalogue/source/2.0.0/sha256-5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c.json`.

The legacy D1 import code at `worker/lib/exercise-media.ts` set
`tracking_type = 'time_distance'` only when
`(body_part || category).toLowerCase() === 'cardio'`; all other 1,324-dataset
exercise definitions received `weight_reps`. It did **not** classify public
exercises into the other three supported tracking types.

The deterministic result is **29 `time_distance` / 1,295 `weight_reps`**.
This verifies the **legacy importer rule**, not the present production D1 table
values. If the precise live D1 values rather than the historical importer
outputs are required, an authorized read-only D1 export keyed by
`reference_source` / `reference_key` must be compared before publication.
Coach-private overrides must not be merged into the shared public catalogue.

## Reproducible release candidate

After obtaining the original immutable JSON through the authorized R2
read procedure, run **only the data preparation command**, not the publisher:

```sh
node tools/exercises/restore-legacy-tracking.mjs /secure/source-v2.0.0.json /secure/source-v2.1.0.json
```

The script verifies the raw input SHA-256, exactly 1,324 distinct four-digit
IDs and the expected 29/1,295 classification before emitting the new JSON.
It never contacts Dexie Cloud. All exercise fields except the new
`tracking_type` are preserved. The root `schema_version` becomes `2.1.0`.

Expected SHA-256 of the generated UTF-8 JSON is:
`ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66`.

No existing R2 content-addressed object may be overwritten. Once publication
is explicitly approved, the new release candidate can be stored under its
own content-addressed R2 key, not the original v2.0.0 key.

## Publication is a separate, protected action

The existing initial publisher `publish-public-catalogue.mjs` still refuses
changes to already-active records. The reviewed tracking-only updater
`update-public-tracking.mjs` has a separate, manually triggered
`tracking-preview` / `tracking-publish` path in the same GitHub workflow.

See [dexie-public-tracking-update.md](./dexie-public-tracking-update.md) for
the approved execution sequence, R2 backup, versioned source upload, precise
allowed data changes, activation marker, rollback limitations and readback
verification.

To keep already deployed v2.0 clients working throughout the rollout,
the `sourceSha256` of each exercise and the manifest's `schemaVersion`
remain pinned to the original immutable v2.0 source. After all tracking
values are verified, two separate marker properties activate the new
tracking release: `trackingSchemaVersion: '2.1.0'` and the pinned
`trackingReleaseSha256`. This ensures no source-hash mismatch interrupts
ordinary catalogue reads during staged upserts. Existing personal
definitions remain independent.

**Merging code does not write to Dexie Cloud.** Publication requires
a separate protected, reviewer-approved GitHub Actions run.
