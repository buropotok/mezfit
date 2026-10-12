# Direct Dexie Cloud cutover: coach–client relationships

Status: implementation sequencing for **empty pre-MVP data**, no D1 data migration
or backward-compatibility layer.

## Architectural decision

- An accepted Worker-provisioned relationship realm and its two memberships
  are the only authoritative source for the coach–client relationship.
- `contactProfiles.name` is the current server-verified Telegram display label,
  materialized into each relationship realm; `member.name` is only a legacy
  fallback for links without a profile. Names never authorize access.
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


## Signed Telegram profile and private portrait projection

The contact profile is **not** part of Dexie Cloud's system-managed `members`
table. Worker REST upserts replace entire objects; upserting `members` for a
cosmetic name/photo change could inadvertently restore a concurrently revoked
membership. The separate, ownerless `contactProfiles` table is read-only to
both ordinary roles; a privileged Worker writes only the verified user's
per-relationship records.

- Browser: the existing UIkit `Avatar` receives a private `blob:` URL from
  an **account-scoped local IndexedDB media cache**. Its fallback initials,
  mechanics and presentation remain unchanged.
- A signed Telegram identity refresh on App entry compares the current name
  and Telegram Bot API photo `file_unique_id` to cloud profile metadata. If
  unchanged, neither the cloud record nor R2 image is rewritten.
- New photos are validated as JPEG, capped at 2 MB, stored at immutable,
  content-versioned keys in private Cloudflare R2. Cloud profiles store only
  `avatarVersion`; photo bytes are *not* synchronized by Dexie Cloud.
- Only an account that is a member of the same validated ownerless relationship
  realm can obtain the image via the authenticated Worker endpoint. The Worker
  checks canonical pair IDs/roles/acceptance and the requested current version.
  Browser media cache entries are pruned after confirmed cloud synchronization
  removes access or changes photo version.
- If Telegram hides the photo or the Bot API is unavailable, avatars gracefully
  fall back to initials. Cloud label refresh still operates if media fails.
- A given person's profile is projected separately into each permitted realm
  for server-enforced visibility. The source of truth is the **currently
  signed Telegram identity**, not previously persisted D1 `app_user` fields.

### Required schema deployment before enabling the frontend

`CLOUD_DATABASE_VERSION` increases to 2, adding
`contactProfiles: 'id, realmId, userId'`, without modifying the original v1
table declarations or importing any old D1 data. In the existing privileged
Dexie Cloud Codespace, while connected to the verified production database:

```bash
npx dexie-cloud import cloud/schema-contact-profiles.json
npx dexie-cloud export --schema
```

Confirm the exported schema includes `contactProfiles` with primary key
`id`. The import is additive; no role grant is added. **Import the schema
before merging/deploying this frontend** when the server schema is sealed.
Never paste the admin key or a complete user/data export into chat.
