# Direct Dexie Cloud cutover: coach–client relationships

Status: implementation sequencing for **empty pre-MVP data**, no D1 data migration
or backward-compatibility layer.

## Architectural decision

- An accepted Worker-provisioned relationship realm and its two memberships
  are the only authoritative source for the coach–client relationship.
- `member.name` is the supported Dexie Cloud display label. The Worker sets
  both labels from already-verified Telegram identities when accepting an
  invitation. Names are not authoritative for access control.
- Use `tg:<telegramUserId>` as the stable user identity and the deterministic
  `realmId` as the relationship identity. Never copy D1 numeric IDs into the
  cloud domain model.
- Coach and client directories must ultimately read reactive local Dexie
  `members` / `realms`, validate the expected canonical realm, and never
  fall back to `getCoachClients` / `getClientCoaches`.
- Identity verification, invitation tokens and membership provisioning stay in
  the privileged Worker. Dexie Cloud Addon owns ordinary reads/sync.
- There is no migration of old `coach_client` rows or user/program records:
  evaluation data can be cleared deliberately before cutover.

## Implementation progress

1. **Done (PR #400):** new Worker-provisioned memberships store verified
   Telegram display names. Their cloud IDs and permissions are unchanged.
2. **Coach/client directory cutover:** both lists and coach selection read
   reactive `db.members` / `db.realms` through one account-scoped Dexie
   Cloud database. The former D1 directory endpoints and numeric contact
   contracts are removed, without a fallback or data import.
3. **Next — exercise catalogue:** the old client-scoped exercise API requires
   a numeric D1 user ID and cannot consume cloud IDs. Its tab in the coach's
   client workspace displays a clear deferred message until the dedicated
   Dexie exercise domain replaces it. Existing independent exercise screens
   remain unchanged.
4. **Remaining D1 consumers:** personal programs, calendar/workouts, roles
   and invitation token bookkeeping still depend on D1. The Worker currently
   maintains the legacy `coach_client` projection only for those unconverted
   endpoints' authorization. It is **not** used for directory reads and must
   be deleted with the last consumer, not preserved as a parallel directory.
5. **Identity and remaining domains:** replace their repositories with cloud
   IDs and remove their obsolete D1 routes and tables. No existing D1 business
   rows are migrated.

While cloud PLAN ACLs remain unverified, `VITE_CLOUD_ASSIGNED_PROGRAMS_ENABLED`
still guards assigned PLAN writes. With the flag off, the UI does not send
new assigned-program writes to D1; client programs clearly indicate that the
cloud feature is not yet active. This is a security gate, not a compatibility
fallback.

## Checks at each cutover

- Coach A with clients B/C sees exactly B/C; B cannot see C, and selecting
  another coach changes visible assigned programs.
- Repeated invite acceptance remains idempotent; the same canonical realm and
  exactly two accepted members are reused. Names appear on both devices.
- Direct client attempts to change PLAN or realm memberships fail on the Dexie
  Cloud server; no trust decision uses `member.name` or a UI-supplied ID.
- An offline device shows previously synchronized relationships without HTTP
  directory calls. Fresh membership requires connectivity.
- Changing Telegram accounts never reuses another user's local cloud data.
- Existing D1 business features may coexist **only as different, not-yet-
  migrated domains**; no domain is ever read from two competing APIs.
- CI runs tests/typecheck/build on the PR. Live server ACLs and cross-device
  synchronization still require two verified Telegram accounts.

Existing audit caveat **A-007**: the original D1 user bootstrap can retain
stale verified Telegram display names. This prerequisite does not attempt to
rewrite that independently tested profile policy; its fix is part of the
dedicated identity/profile cutover. There is no production data migration.
