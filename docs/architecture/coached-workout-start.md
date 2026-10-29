# Confirmed coached Start of an independent client workout

An independent occurrence may be started as independent only by its athlete.
A Coach can still inspect and edit the authorized client's PLAN. Start by a
different athlete's Coach requires MezfitDialog:

> Вы не можете начать самостоятельную тренировку спортсмена. Начать эту тренировку в зале с клиентом?

No/backdrop dismisses without conversion, execution or an error toast. Yes
requests an explicit coached Start through the shared provider. The repository
rereads current membership, occurrence, lifecycle and conflicts. It atomically
sets `format: coached` on the same occurrence and creates execution. No participant,
realm, owner, source PLAN, timing or origin identifier changes. Failed creation
or unresolved conflicts leave the occurrence independent. Own independent
workouts and Client athlete execution retain their existing paths.

## Activation

The existing grants lack permission to update `workoutOccurrences.format`.
`cloud/coached-start-roles.json` adds only that field to Coach on the complete
reviewed Client execution baseline. Client grants remain byte-semantically
unchanged. No schema or business-data migration is involved. Until activation,
confirmed conversion is rejected locally with an error for the caller's bottom
toast; the occurrence and execution graph are unchanged.

After merge, the repository owner runs **Apply Dexie Coach workout format ACL**
(`.github/workflows/dexie-coached-start.yml`) on main: preview, inspect the one
Coach delta, then apply with `APPLY_COACHED_START_ACL`. Use the existing
`dexie-production` environment and environment secret, required reviewers and
shared writer concurrency. The operator checks the exact old/new profiles,
reexports full schema and roles immediately before import and verifies full
readback after an attempted import (including failure) or no-op apply. It does
not change source PLAN, Client permissions, membership, schema, other roles or
business rows; a drifted baseline fails closed. Older ACL operators are not
widened to overwrite this extension. Membership preflight accepts complete
previous and extended profiles only.

No live permission installation or ordinary-account authorization test is
performed by opening the PR. After apply, test a Coach confirming conversion
and a Client starting their own independent occurrence, inspect synchronization
and verify an unrelated user still cannot access or mutate the relationship.
