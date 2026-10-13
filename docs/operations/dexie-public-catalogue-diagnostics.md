# Read-only Dexie Cloud public catalogue diagnostics

## Purpose and boundaries

This is an operator workflow, **not** the publication or activation pipeline.
It inspects the existing Dexie Cloud database configured by `dexie-cloud.json` and
reports public catalogue readiness without modifying schema, roles or data.

Workflow: `.github/workflows/dexie-public-catalogue-diagnostics.yml`.

- Exports the current cloud schema and role definitions, plus **only** `rlm-public`.
- Checks the three public exercise table declarations, counts exported records,
  the expected publication manifest, and obvious public-table/wildcard references
  in ordinary coach/client role permissions.
- Summarizes only table names, counts, and booleans. **The report is not a full
  integrity verification or a server-authorized permissions test.**
- Does not call Dexie Cloud `import`, `authorize`, `clear-*`, `delete`, or
  any other write operation.
- Does not use Cloudflare/R2 credentials. The source JSON may already be in R2,
  but this workflow does **not** attest its presence or hash.
- Does not upload full exports or secrets as CI artifacts. This repository is
  public; publishing private data through workflow logs/artifacts is forbidden.

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
The secret is written to a temporary `dexie-cloud.key` with owner-only access
and removed after the run. The `*.key` pattern is gitignored.

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

- Missing cloud table: review the remote schema; changing local Dexie versions
  does not automatically install server schema/ACLs.
- 0 exercise/taxonomy rows: public realm has not been staged or is not
  readable under this credential.
- Missing manifest: the public release has not been activated.
- 1324/69 rows and matching manifest: only *aggregate state* is present;
  this alone does not confirm record-level consistency or access control.
- Any suspicious ordinary role permission: inspect and resolve it before
  introducing write access or activation.

## Next phase: separately approved publishing

Once the diagnostics are reviewed, prepare a separate, gated operator change
for a `GLOBAL_WRITE` account. That phase must back up schema and public data,
verify the R2 source SHA-256, stage additive records, re-export the staged realm,
compare **all** source fields using `tools/exercises/prepare-public-catalogue.mjs
--verify-export`, and import the manifest **last**. Never delete existing rows
or overwrite private coach-client realms as a side effect.

The canonical operator sequence is in
`docs/architecture/public-exercise-catalogue-pr1.md`.
