# Read-only Dexie Cloud public catalogue diagnostics

## Purpose and boundaries

This is an operator workflow, **not** the publication or activation pipeline.
It inspects the existing Dexie Cloud database configured by `dexie-cloud.json` and
reports public catalogue readiness without modifying schema, roles or data.

Workflow: `.github/workflows/dexie-public-catalogue-diagnostics.yml`.

- Authenticates with only `ACCESS_DB` and `GLOBAL_READ` via `POST /token`.
- Uses `GET /all/<table>?realmId=rlm-public` on just the three public exercise tables.
- Counts returned records and checks publication manifest metadata.
- **Cannot inspect server schema declarations or permission roles** with these scopes.
  Those require a separate administrator review before publishing.
- Summarizes only table names, counts, and booleans. **The report is not a full
  integrity verification or a server-authorized permissions test.**
- Does not run administrative Dexie CLI export or call `import`, `authorize`,
  `clear-*`, `delete`, or any write operation.
- Does not use Cloudflare/R2 credentials. The source JSON may already be in R2,
  but this workflow does **not** attest its presence or hash.
- Does not write raw records or secrets to disk or upload them as CI artifacts.
  All JSON responses are processed in memory; the output is a safe aggregate report.
  This repository is public: private data is never written to workflow logs/artifacts.

## One-time service account setup (database manager only)

In a trusted terminal already connected as the Dexie Cloud database manager,
create a **read-only** service account using the official Dexie CLI:

```sh
npx dexie-cloud authorize diagnostics@your-domain.example \
  --service-account \
  --scopes ACCESS_DB,GLOBAL_READ \
  --out dexie-cloud-diagnostics.key
```

Choose an address/identifier under your control instead of the example value.
The existing database must be `https://zjv60oxag.dexie.cloud`. Never create a
second database and never commit or paste the key into chat.

In **GitHub → buropotok/mezfit → Settings → Secrets and variables → Actions**,
create a repository secret with name **`DEXIE_CLOUD_KEY_JSON`**. Paste the
entire JSON contents of `dexie-cloud-diagnostics.key`, including its mapping
from database URL to `clientId` and `clientSecret`.

The Actions job checks that this mapping matches the checked-in database URL.
The credentials and short-lived token remain in process memory. No key or raw
export file is written to disk. The `*.key` pattern remains gitignored for
manual administrator operations.

**Do not grant `GLOBAL_WRITE`, `MANAGE_DB`, `DELETE_DB`, `IMPERSONATE`
or wildcard scopes to this diagnostic account.** A future publication workflow
requires an explicitly separated identity and review.

The existing `CLOUDFLARE_API_TOKEN` does not authenticate to Dexie Cloud and
must not be reused as a substitute.

## Triggering diagnostics

After this workflow is merged into the default branch, either:

1. Open **Actions → Diagnose Dexie public catalogue → Run workflow**; or
2. Add the exact comment `/dexie-public diagnose` to a normal repository issue
   while signed in as the repository owner, `buropotok`.

The issue-comment trigger allows the connected GitHub operator to initiate
diagnostics by posting that comment. The job ignores pull request comments,
comments from other actors, and every other command. The workflow itself
executes from the default branch, not from an issue's content or a PR branch.

The result is visible in the GitHub Actions run summary and in a short-lived
`dexie-public-catalogue-diagnostics` artifact containing **only** `report.md`.

### Interpret the result

- Table query `unavailable` (HTTP 404): cannot confirm whether the table exists
  or is configured; **not** equivalent to zero rows. The admin must review schema.
- 0 exercise/taxonomy rows after a successful query: no records were found in
  `rlm-public` for the relevant table.
- Missing manifest: the public release has not been activated.
- 1324/69 rows and matching manifest: only *aggregate state* is present;
  this alone does not confirm record-level consistency or access control.
- Any HTTP 401/403, malformed response or unexpected record realm is a failed
  diagnostic, not a successful empty catalogue.

Server-side schema and permissions require a separate admin review. The older
`tools/exercises/report-public-catalogue.mjs` remains an **offline-only helper**
for manually obtained privileged CLI exports and is not used by this workflow.
This distinction is intentional: old offline tests remain relevant, but the
GitHub workflow does not request administrative export scopes.

## Next phase: separately approved publishing

Once the diagnostics are reviewed, prepare a separate, gated operator change
for a `GLOBAL_WRITE` account. That phase must back up schema and public data,
verify the R2 source SHA-256, stage additive records, re-export the staged realm,
compare **all** source fields using `tools/exercises/prepare-public-catalogue.mjs
--verify-export`, and import the manifest **last**. Never delete existing rows
or overwrite private coach-client realms as a side effect.

The canonical operator sequence is in
`docs/architecture/public-exercise-catalogue-pr1.md`.
