# Dexie Cloud coach-client relationship pilot bootstrap

Status: **administrative pilot only**. This is not the production invitation or
relationship API, and it does not migrate data from D1. The existing D1
coach-client relationship remains untouched.

## Purpose and trust boundary

The Telegram token endpoint already uses a deliberately narrow
\`ACCESS_DB,IMPERSONATE\` service account. **Do not add GLOBAL_READ or
GLOBAL_WRITE to that account.**

Dexie Cloud's \`/all/realms\` and \`/all/members\` administrative REST API
requires a different token with \`ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE\`.
Use a separate database-manager/admin credential **only in an explicitly
invoked local administrative command**, never in the browser or in a
Cloudflare Worker route.

\`tools/dexie-cloud-relationship.mjs\` performs a one-time, explicitly
authorized pilot bootstrap using the database URL from the checked-in
\`dexie-cloud.json\` and a private key file outside Git:

- Accepts two distinct numeric Telegram user IDs: one coach and one client.
  IDs are operational inputs from the administrator, **not** trusted
  browser-provided identity or proof of a relationship.
- Derives one deterministic \`rlm...\` realm ID for the ordered pair and
  deterministic \`mmb...\` IDs for the two members.
- Verifies the installed **global** \`coach\` and \`client\` role permissions
  using \`GET /public/roles\`. Stops if the declared allowlists differ.
- Checks the realm and all existing members through \`/all\` **before**
  writing. Refuses any non-null realm owner, changed realm identity,
  unexpected participant, extra member, changed role, direct permission,
  or non-accepted membership.
- Creates a realm with \`owner: null\` and two accepted members with
  \`invite: false\`, \`roles: ['coach']\` or \`roles: ['client']\`,
  and **no direct permissions**.
- Confirms the result with read-back requests and separately minted
  \`ACCESS_DB\` user tokens for \`tg:<coach ID>\` and \`tg:<client ID>\`.
  Neither user token has any GLOBAL_* scope.

Only fixed, non-sensitive result codes are printed. The tool never logs the
service credentials, access tokens, full request/response objects, or Telegram
signed \`initData\`. It is not mounted in the Worker, does not expose an API
route, and does not require a new Cloudflare secret.

## How to run in the secure Codespace

The CLI owner/manager key uses the same database-key JSON layout as
\`dexie-cloud.key\`: an entry for
\`https://zjv60oxag.dexie.cloud\` containing \`clientId\` and
\`clientSecret\`. Use an existing authorized manager key with
\`ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE,IMPERSONATE\` capabilities.
The currently deployed \`mezfit-worker-auth.key\` is **not suitable**
because it was intentionally issued only \`ACCESS_DB,IMPERSONATE\`.

Dry run (local ID computation only; does not read credentials or use network):

    node tools/dexie-cloud-relationship.mjs \
      --coach <COACH_TELEGRAM_ID> --client <CLIENT_TELEGRAM_ID>

Explicitly apply with the admin key stored outside Git:

    node tools/dexie-cloud-relationship.mjs \
      --coach <COACH_TELEGRAM_ID> --client <CLIENT_TELEGRAM_ID> \
      --key /absolute/path/to/authorized-manager.key --apply

The admin key path can alternatively be passed through
\`DEXIE_CLOUD_ADMIN_KEY_FILE\`. Do not commit key files, put keys in command
arguments, or use the Cloudflare Worker secrets for administrative writes.

An authorized invocation returns only
\`{"realmId":"rlm...","applied":true,"membersVerified":2}\`.
If the remote schema is not installed or is inaccessible, the command fails
before creating the realm. If the write fails after the realm is created,
repeat the **same** command for the **same ordered pair**: it checks existing
records and resumes missing writes. It never deletes relationships or
silently repairs conflicting or privileged members.

**No changes to the existing D1 link** are required; no synchronization of
plans/sessions/facts is enabled by this pilot.

## What the checks do and do not establish

The result proves that Dexie Cloud accepted this exact realm/member
configuration and that user-scoped REST tokens can read the relationship
realm. The repository tests use simulated REST responses to exercise failure,
idempotency, role drift, and least-privilege conditions. They are not
equivalent to live Dexie Cloud permission tests.

Before activating a production domain repository or workout synchronization:

1. Exercise the actual Telegram issuance path independently for both users.
2. Verify the cloud schema and create **isolated synthetic** PLAN and FACT
   records with explicit \`owner: null\` in the relationship realm.
3. Verify at the actual Dexie Cloud server that client PLAN mutation is
   denied, coach PLAN mutation is allowed, both may update **only** allowed
   FACT fields, and neither may modify lifecycle snapshots, realm membership
   or ownership.
4. Create a second relationship with a different test client to prove
   cross-client isolation. Do not assert isolation from visibility of only
   one relationship.
5. Replace this manual bootstrap with verified Telegram invitation
   acceptance and narrow Worker privileged operations before production use;
   do not treat imported/admin-provided Telegram IDs as an authorization
   source for the runtime.

The Dexie Cloud REST \`POST /all/...\` API performs upserts, not an atomic
multi-table transaction. This pilot guards against accidental overwrites and
is retryable, but **cannot promise global atomicity** with concurrent
administrators. Use one operator for the pilot, and stop on any conflict.

## References

- https://dexie.org/docs/cloud/rest-api
- https://dexie.org/docs/cloud/access-control
- https://dexie.org/docs/cloud/cli
- \`AGENTS.md\`
- \`docs/architecture/local-first-storage-sync.md\`
