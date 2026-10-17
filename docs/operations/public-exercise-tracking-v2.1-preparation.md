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

## Publication is a separate, protected change

**Do not point the current `publish-public-catalogue.yml` at this file.**
The published Dexie records already use the same IDs; current
`publish-public-catalogue.mjs` deliberately refuses differences in existing
records and a changed manifest. No Git merge publishes public data.

Before publication, a separate versioned-update design and authorization
must be approved against `AGENTS.md` §21, along with a backup, restoration
plan, explicit allowed-diff checks, server permission review and a
protected operator-only GitHub Actions operation. In particular, changing
the `sourceSha256` of active rows in batches while the existing manifest
remains active would make the current snapshot reader reject a partially
updated catalogue. Publication must avoid exposing this mixed state.

The frontend currently accepts v2.0.0 and v2.1.0 manifests; it requires
`tracking_type` on every record for v2.1.0, and both approved releases
retain the original R2 GIF identity. Existing personal definitions may still
lack the new field; this preparation does not rewrite private user data.

**No Dexie Cloud write, R2 upload or production publication is part of this
preparation change.**
