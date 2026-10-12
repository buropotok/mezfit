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
- The provider opens the cloud database only while the Programs destination is
  active, uses the authenticated account's local DB name, and closes on cleanup.
  The account ID key forces a remount on account change.

## Transitional limitations (intentional)

- This slice does **not** migrate or expose phases, days, exercise definitions,
  sets, workout schedule, PLAN snapshots, Workout Start or FACT. Newly created
  cloud headers intentionally do **not** open the old numeric-ID D1 editor.
  Never call D1 phase/mutation endpoints with a cloud string ID.
- The coach's **personal** programs retain their existing D1 editing flow until
  a separate dedicated personal-realm migration. Client-owned personal
  programs must later have client-write / coach-read semantics and not receive
  coach-assigned PLAN permissions.
- Previously created D1 *assigned* programs are not migrated, copied or listed
  as if they were Dexie Cloud headers. Existing D1 domain APIs remain for other
  legacy consumers during the migration.
- Legacy client/coach directory and selected-trainer metadata still come from
  the D1-backed API. Cloud headers can render locally in the coach screen when
  the old directory is unavailable (without display names), but complete
  **offline client navigation** will require migration of that directory and
  selection model. This pilot does not claim that offline UX is complete.
- The app does not offer a server-confirmed sync-success indicator in this
  slice. Confirm cloud persistence with a second Telegram account or cloud
  read-only export.

## Manual two-account acceptance check after CI/deploy

1. In Telegram, connect coach A to client B. Confirm client C is connected
   separately. Both already have the Worker-created non-owned realm and two
   accepted memberships.
2. Open Coach A > Programs > Create program, choose B, enter a unique test
   name and save. Check that the header appears on the coach list under
   `Программы Dexie Cloud` (not the old private D1 list).
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
