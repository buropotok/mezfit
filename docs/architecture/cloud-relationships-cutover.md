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

## Required implementation order

1. **Membership display contract** (first safe prerequisite): write names into
   accepted `members` records when Worker provisions the relationship.
   This introduces no second directory API and does not change authorization.
2. **Dependents of numeric D1 IDs:** replace the client-scoped exercise
   catalog and other relevant consumers with cloud string IDs / repositories
   *before* the directory switches. Do not add temporary numeric-ID bridges or
   remove a working screen to make the directory migration appear complete.
3. **Directory cutover:** use a single account-scoped cloud database lifecycle
   for both plan and membership subscriptions; implement coach/client contact
   lists and chosen-coach selection from synced memberships, with retry,
   account switching, and graceful offline views of already-synced entries.
   Remove the old `getCoachClients` and `getClientCoaches` UI dependencies in
   the same cutover PR rather than carrying a feature flag or parallel API.
4. **Retire privileged D1 projection after last legacy consumer:** once D1
   workout/program/exercise authorization paths are replaced, stop writing
   `coach_client` during invitation acceptance, remove D1-based relationship
   queries and corresponding dead endpoints/types. Do not drop their table
   while any live legacy feature still depends on it.
5. **Finish identity cutover:** switch role/profile bootstrap to the verified
   Telegram identity plus approved Dexie Cloud record/contracts, and delete
   obsolete D1 business storage and migrations when no domain consumers remain.

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
