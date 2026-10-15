# Coach exercise catalogue v5: server rollout boundary

The app's local Dexie v5 adds three private coach tables. The live Dexie Cloud schema checked on 2026-10-15 contains 21 tables and does not yet contain them.

| Table | Cloud primary key | Purpose |
| --- | --- | --- |
| coachExerciseOverrides | id | Personal changes to immutable four-digit public exercises |
| coachExerciseDefinitions | id | Original coach-created exercises |
| coachExerciseFavourites | id | Per-coach favourites referencing public/private IDs |

The additive-only reviewed schema payload is **cloud/schema-coach-exercises.json**. Verify the target Dexie Cloud URL is the existing approved database, compare a fresh schema/roles export with the manifest, back up metadata as required by the database administrator, and apply ONLY the three schema declarations with an authorized database manager account. After import, export schema and roles again: the new tables must have primary key id; all prior keys and global roles must remain unchanged. Do not import roles or business data.

**Do not reuse the workout-v4 workflow to import arbitrary tables.** The existing publisher write key is allowlisted for operations in AGENTS.md §21. This requires a separate administrator-approved cloud configuration step, never an application PR/push action.

## Access boundary

Dexie Cloud's built-in private realm ID equals the authenticated user ID (tg:<telegramUserId> in Mezfit), and does not require rows in realms/members. Each coach row explicitly sets realmId and owner to this identity. No global coach/client permissions are changed. A client must receive a separate relationship-realm snapshot of any custom exercise used in assigned programs, not direct access to the private catalogue.

The public realm rlm-public is immutable. An override applies a patch while preserving canonical exercise IDs and source hashes. Favourites are user-owned references, never fields on public definitions.

## Deployment order

1. Review and deploy the three server tables with administrator approval.
2. Verify the server schema/roles export and private realm read/write isolation using two real identities.
3. Only then release the Dexie v5 client; local writes must not be represented as cloud-synced before that.
4. Rework the legacy D1 editor in a follow-up PR and connect it through the prepared coach editor gateway.

No business data, personal memberships or privileged credentials should be exposed in CI logs.
