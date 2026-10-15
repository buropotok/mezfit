# Coach exercise catalogue v5: server rollout boundary

The app's local Dexie v5 adds three private coach tables. The live Dexie Cloud schema checked on 2026-10-15 contains 21 tables and does not yet contain them.

| Table | Cloud primary key | Purpose |
| --- | --- | --- |
| coachExerciseOverrides | id | Personal changes to immutable four-digit public exercises |
| coachExerciseDefinitions | id | Original coach-created exercises |
| coachExerciseFavourites | id | Per-coach favourites referencing public/private IDs |

The exact allowlisted schema manifest is **cloud/schema-coach-exercises.json**.

## Protected GitHub Actions publishing (no manual Dexie CLI)

After merging the reviewed workflow into `main`, open **Actions → Apply Dexie Cloud coach exercise schema** (`.github/workflows/dexie-coach-exercises-schema.yml`).

1. Select branch **main**, operation **preview**, leave confirmation blank. Run the workflow, approve the protected `dexie-production` environment, and review the log's list of missing tables. No cloud changes occur in preview.
2. When the missing-table plan is correct, start a new run on **main** with operation **apply** and confirmation **APPLY_COACH_EXERCISES_V5_SCHEMA**. Approve the protected environment.
3. The workflow exports schema/roles before import, imports **only missing allowlisted tables**, then re-exports schema/roles and fails unless the three `id`-keyed tables are present, every earlier table/key remains unchanged, roles remain identical and `sealed` has not changed.
4. Repeat operation **preview** and expect `Missing tables (0)`. The apply operation is safe to repeat: no already-installed table is re-keyed or re-imported.

Only the repository owner may dispatch this workflow. There are **no** PR/push triggers, no new credentials, no role imports and no user data imports. The environment secret `DEXIE_CLOUD_WRITE_KEY` is consumed by the same isolated credential-preparation routine as the workout schema workflow. Both workflows share one concurrency group.

**Do not use the workout-v4 workflow to import arbitrary tables.** The new workflow's separate three-table allowlist is approved explicitly under AGENTS.md §21; other new schema or permission changes need a fresh review.

## Access boundary

Dexie Cloud's built-in private realm ID equals the authenticated user ID (tg:<telegramUserId> in Mezfit), and does not require rows in realms/members. Each coach row explicitly sets realmId and owner to this identity. No global coach/client permissions are changed. A client must receive a separate relationship-realm snapshot of any custom exercise used in assigned programs, not direct access to the private catalogue.

The public realm rlm-public is immutable. An override applies a patch while preserving canonical exercise IDs and source hashes. Favourites are user-owned references, never fields on public definitions.

## Deployment order

1. Merge the protected schema workflow and run preview/apply through GitHub Actions, with production environment approval.
2. Verify the exported server schema/roles and private realm read/write isolation using two real identities.
3. Only then release the Dexie v5 client; local writes must not be represented as cloud-synced before that.
4. Rework the legacy D1 editor in a follow-up PR and connect it through the prepared coach editor gateway.

No business data, personal memberships or privileged credentials should be exposed in CI logs.
