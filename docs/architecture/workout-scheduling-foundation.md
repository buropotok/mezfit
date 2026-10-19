# Workout scheduling

Status: local-first calendar; private prescription drafts; ordinary Dexie Cloud replication.

## Local writes and visibility

Program and phase must be Active locally when initially scheduling a day. The
resulting private draft owns a deep PLAN snapshot and stays in the unsynced
`localWorkoutOccurrenceDrafts` table. This is intentional: unsaved content must
not be sent to a client. The source program is provenance, never a cloud dependency.

Save atomically adds/updates `workoutOccurrences`, marks a local sync revision,
and removes the private draft. It does not call Worker/HTTP or wait for a push.
Addon replicates the occurrence in the background. Offline and synchronization
errors never freeze local work. Database v11 adds only unsynced sync-presentation
metadata. No synchronized schema change is required.

Opening a saved occurrence is a read. Content edits create a private draft overlay;
the client retains the previous published prescription until Save. Date/time
changes, timeline move and resize commit timing immediately and do not create a
draft. Timing edits to an existing draft preserve its draft status. A saved
workout has no Save/footer actions; content editing restores them. The synchronization
capsule below the title reports local pending revisions and actual Addon push
confirmation, independently from whether the content is a private draft.

## Calendar, authorization and gestures

Both client and coach use the same typed local repository. A personal occurrence
uses the personal realm; assigned occurrences use the verified relationship realm
and owner equal to that realm ID. Addon 4.4.15 rewrites falsy owner values; a
truthy realm ID cannot match a verified Telegram user ID, so it grants neither
participant implicit owner privileges. Server-created owner:null rows remain readable. Field-scoped cloud roles protect participant/realm identity and
source PLAN/session tables. Coach can edit assigned occurrence prescriptions;
client can schedule independent workouts and change timing, not coach PLAN. Calendar cancellation writes cancelledAt;
execution status and workoutSessionId are never included in ordinary member
update grants. No new privileged cancellation request or synchronization barrier
is introduced.
Static membership is checked locally from the authorized subset and by cloud ACL.
No Worker business validation, cloud-template comparison or synchronization barrier
participates in saving. Session Start remains outside this scheduling correction.

The local slot check includes the athlete and, for coached sessions, coach across
all accessible occurrences and device drafts. Adjacent intervals are allowed.
Confirmed occurrences survive source deletion/status changes. Partial midnight/DST
segments remain clickable, but whole-booking gestures are disabled on them to
avoid rewriting the interval from one segment. Whole intervals retain normal gestures.

## Avatar lifetime

Contact images use the existing permission/version-checked IndexedDB Blob cache.
An account/provider-owned Blob URL cache reuses decoded image sources across day
page remounts instead of clearing src and revoking/recreating URLs for every card.
Version/permission changes invalidate entries and pending results. Account cleanup
revokes all URLs. No catalogue or portrait network request blocks calendar work.

## Deployment

The existing cloud roles intentionally prohibited ordinary occurrence writes;
that was incompatible with the required local-first Save path. After merge run
`.github/workflows/dexie-local-calendar-acl.yml` on main: preview, then apply with
confirmation `APPLY_LOCAL_CALENDAR_COACH_CLIENT_ACL`. The existing protected
publisher is used. The operator accepts only the exact previous role baseline or
already-installed target; rechecks before import and verifies every role plus
unchanged schema after the attempt. It cannot change membership, data, source PLAN,
FACT, session tables or unrelated roles. PR/push never applies cloud ACL.

The prior scheduling-confirm API is retired from the frontend. Its old Worker
Durable Object infrastructure is not used for calendar persistence. No compatibility
bridge or custom sync/retry engine replaces Dexie Cloud Addon.
