# Dexie Cloud assigned program headers — first runtime slice

Status: **test-only header pilot**, not the complete training-program migration.

## Product behavior and data ownership

The existing Coach > Programs > Create program dialog is reused. When the
coach chooses an **already linked client**, Save creates one `trainingPlans`
header **only in Dexie Cloud Addon / local IndexedDB**, with server synchronization
handled by the addon. No matching D1 program is created. The client reads
these headers on the existing Client > Programs screen for the selected coach.
The card contains a title, `draft` status, coach/client cloud IDs and a stable
`realmId`. Its owner is explicitly `null`.

- The actual relationship realm is discovered from accepted/synced `members`
  and `realms` visible to the verified Telegram account. It must be
  ownerless and contain the coach and client in the expected roles.
- IDs in the UI select a relationship; they do **not** authorize writes.
  Dexie Cloud's installed `coach` / `client` role policy is the server
  enforcement boundary. The existing Worker invitation route remains the only
  way to provision relationship realms and memberships.
- New assigned headers are created locally, so rendering does not require
  waiting for an API response. The addon handles push, pull and reconnect.
  Local success alone is **not** evidence of server acceptance.
- The account-scoped cloud provider opens a single Dexie database for
  relationship directories on all screens. The PLAN subscription is active
  only on the Programs destination while its rollout gate is enabled.
  The account key forces a remount and closes subscriptions on account change.

## Explicit rollout gate (required)

The cloud *assigned PLAN* pilot is **disabled by default**. The coach/client
relationship lists use Dexie Cloud regardless of this flag. With the PLAN
gate disabled, creating assigned programs is unavailable (never sent to D1)
and the client's Programs page clearly reports the inactive cloud feature.
The coach's personal legacy D1 programs remain independent until their own
domain is converted. This avoids introducing unverified cloud PLAN writes.

The gate is the build-time Vite variable
`VITE_CLOUD_ASSIGNED_PROGRAMS_ENABLED=true`, sourced by
`.github/workflows/deploy.yml` from the GitHub Actions repository variable
`VITE_CLOUD_ASSIGNED_PROGRAMS_ENABLED`. The deploy workflow never sets it
automatically, and it must remain absent/false until the manual checklist
below is satisfied. Changing this variable requires a **new deploy/build**;
it does not enable the pilot on an already-built web application.

Before enabling, in the privileged Dexie Cloud CLI environment:

1. Confirm the intended database URL and export the currently installed roles.
2. Install/reconcile `cloud/roles.json` and verify the **installed** coach
   and client allowlists. Check for old or broader grants: additive role
   imports do not reliably revoke them. Verify `coach` may manage only
   assigned `trainingPlans`, `client` has no PLAN writes, and neither
   role can administer relationship realm/members or reserved PLAN identity
   fields through ordinary sync.
3. With two separate Telegram identities and the Worker-created ownerless
   realm, directly confirm allowed coach PLAN mutation, rejected client
   mutation and cross-client isolation against the **real** cloud server.
4. Only after these checks set the GitHub Actions variable to `true` and
   deploy the app. Verify the same behaviors again through the app on both
   devices. Set it back to `false` and redeploy if server ACLs or sync
   behavior differ.

This frontend gate controls **feature rollout only**, never authorization;
Dexie Cloud server ACL is still the enforcement point. Successful local
IndexedDB creation is not evidence of cloud acceptance. Do not log or share
admin keys, Telegram initData or user tokens.

## Transitional limitations (intentional)

- This slice does **not** migrate or expose phases, days, exercise definitions,
  sets, workout schedule, PLAN snapshots, Workout Start or FACT. Newly created
  cloud headers intentionally do **not** open the old numeric-ID D1 editor.
  Never call D1 phase/mutation endpoints with a cloud string ID.
- The coach's **personal** programs retain their existing D1 editing flow until
  a separate dedicated personal-realm migration. Client-owned personal
  programs must later have client-write / coach-read semantics and not receive
  coach-assigned PLAN permissions.
- Previously created D1 *assigned* programs are neither migrated nor used:
  the client Programs page shows cloud assigned plans only when enabled.
  Unconverted personal programs, exercises, workout/schedule and role bootstrap
  remain separate D1 domains pending replacement, without directory fallback.
- The coach/client directories and chosen-trainer metadata now use locally
  synced `members` and `realms`. Cloud member labels are filled from Telegram
  on provisioning, with fallback names for older empty test relationships.
  On a previously synced device, directory records remain available offline.
  Fresh membership requires an online accepted invitation.
- The client-scoped exercise tab in the coach's client workspace remains
  deferred until its legacy numeric-ID dependency is converted to Dexie.
- The app does not offer a server-confirmed sync-success indicator in this
  slice. Confirm cloud persistence with a second Telegram account or cloud
  read-only export.

## Manual two-account acceptance check after CI/deploy

1. In Telegram, connect coach A to client B. Confirm client C is connected
   separately. Both already have the Worker-created non-owned realm and two
   accepted memberships.
2. Open Coach A > Programs > Create program, choose B, enter a unique test
   name and save. Check that the header appears on the coach list under
   `Программы клиентов` (not the old private D1 list).
3. Open Client B > Programs with coach A selected. Verify the same name
   appears after sync/reopen, and that changing the selected coach hides it.
   Verify C and unrelated accounts do not see B's program.
4. Create another header for C; verify B does not see it. Restart the app and
   confirm headers persist. During a temporary network disconnection, check
   local creation when the realm was previously synced, reconnect and verify
   remote appearance on B's device.
5. Make a deliberately unauthorized direct client `trainingPlans` mutation
   in a controlled test environment. Confirm that Dexie Cloud rejects it;
   merely hiding editing controls does not prove authorization. Check the
   `owner:null` and `realmId` of the cloud record, not the old D1 table.
6. Check that opening the existing D1 private coach program still works, and
   that assigned cloud cards cannot accidentally invoke the old D1 details API.

No test/example should paste Telegram initData, JWT tokens, cloud service
credentials, or a key file into logs/chat. Automated tests use mocks; real
cloud permissions and cross-device synchronization require this live check.

See `AGENTS.md`, `docs/architecture/local-first-storage-sync.md` and
`docs/architecture/dexie-cloud-foundation.md`.
