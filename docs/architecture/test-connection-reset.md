# Test-only reset of a Coach–Client connection

The Coach client profile exposes **Сбросить тестовую связь** on the Basics tab.
This operation is destructive and intentionally distinct from the production
business action for ending cooperation, which retains historical discussions.

## Activation

The Worker rejects this action unless the verified Coach Telegram ID is listed
in the **server-only** `TEST_CONNECTION_RESET_COACH_IDS` setting. Use a
comma-separated list of canonical numeric Telegram IDs (no `tg:` prefix).
Configure it in Cloudflare Worker environment/secret storage for the chosen
test accounts; do not put the list in the frontend or commit it to the repository.
With the setting unset or empty, every reset receives HTTP 403. It must remain
disabled for real production coaches.

The existing `DEXIE_CLOUD_MEMBERSHIP_CLIENT_*` service credential is reused
server-side. It requires the established `ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE`
scopes. No new administrative client, schema change or ACL expansion is needed.

## Verified flow

1. The Coach explicitly confirms irreversible deletion in a Konsta dialog.
2. Worker verifies the Telegram signed identity, Coach role, server-only test
   allowlist, a canonical safe Client Telegram ID, and an active D1 legacy
   projection for this **specific pair**.
3. Worker derives the deterministic realm ID, obtains its admin token and
   validates that the realm has exactly the expected canonical Coach and Client
   memberships with their normal ownerless roles. Foreign/altered realms abort.
4. Worker preflights known relationship-scoped cloud tables. Unknown table
   response formats, inaccessible tables, or more than 1,000 rows in one table
   abort before deletion. Optional/uninstalled tables can return 404.
5. Worker deletes pair-realm business rows, with readback per table. Only
   afterward does it delete the realm (which cascades memberships). A final
   readback must show the realm absent.
6. Only when Cloud confirms deletion does Worker execute one atomic D1 batch:
   it deletes the old pair-owned training-plan graph, related workout sessions
   and calendar occurrences, then marks the temporary `coach_client` link
   inactive. The client is never deleted from `app_user`; unrelated personal
   plans, exercise definitions and reusable invitation tokens remain intact.
7. Frontend pulls fresh Dexie Cloud contact state; the Client provider also
   drops an invalid selected Coach on its next synchronized read.

A new acceptance of the **same invitation** can recreate the deterministic realm
and its memberships and reactivate the same D1 relationship. Other client/coach
realms, personal profiles, public catalogue and their data are not touched.

## Operational caveats

- This is an online-only administrative test action, **not** an ordinary
  local-first mutation or the production unsubscribe workflow.
- The available documented REST API does not provide the CLI `clear-realm`
  cross-shard atomicity guarantee. The implemented scoped row-by-row cleanup
  may be partially complete if networking fails. In that case D1 remains
  active, and repeating the same action completes missing steps. A failed D1
  transaction also keeps the old relationship active and can be retried. Do not start
  a new invitation acceptance until reset confirms success.
- Local offline copies can remain on devices until their next successful
  Dexie Cloud pull; test on two online accounts and verify both directories.
  If old devices contain unsynced writes, reconnect them and resolve sync
  before treating the pair as pristine.
- Update `TEST_RELATIONSHIP_TABLES` in
  `worker/lib/test-relationship-reset.ts` whenever the cloud adds new tables
  that may contain coach-client realm data. A separate pre-MVP data-domain
  review is necessary before promoting any reset action to production.
- Existing discussion/history retention rules remain unchanged for ordinary
  production relationships. This operator is allowed solely for controlled tests.

## Manual acceptance checks

Connect a fresh Coach and Client, create an assigned program and a workout,
reset the pair from Coach > Client > Основные, synchronize both accounts, and
confirm both directories lose the relationship. Reopen the **same valid invite**:
the pair must reappear without the previous realm data. Also verify that a
second client of the same Coach and any private records remain intact; a
different Coach, a non-allowlisted Coach, or a Client must receive a forbidden
response. Retry once after a simulated Worker/cloud failure without adding an
extra relationship or losing the D1 retry path.
