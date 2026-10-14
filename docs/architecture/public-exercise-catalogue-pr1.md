# PR1: Read-only public exercise catalogue

## Boundaries

- Canonical source: 1324 exercises from `mezfit_exercises_FINAL_ru_anatomy(2).json`, schema 2.0.0.
- Source SHA-256: `5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c`.
- Immutable source in private Cloudflare R2: `exercise-catalogue/source/2.0.0/sha256-5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c.json`.
- Dexie Cloud: tables `publicExerciseDefinitions`, `publicExerciseTaxonomy`, `publicExerciseCatalogues` in `rlm-public`. The ordinary browser has **no write grant** to this realm.
- Dexie Addon owns syncing to local IndexedDB. React accesses local data only via `PublicExerciseCatalogueRepository`.
- No numeric D1 exercise IDs, coach/private overrides, clients, PLAN or FACT in this scope.
- No new exercise JPEG/GIF uploads are part of this rollout. For existing R2 GIFs, the product owner confirmed on 2026-10-13 that these are their GIFs and approved their reuse in Mezfit. Retain original source paths and attribution metadata; show fallback artwork if media is missing.

## Operator-controlled rollout

1. In the admin environment, back up and inspect Dexie Cloud's **existing** schema (`npx dexie-cloud export --schema`), append the three table declarations from local Dexie version 3, retain all pre-existing tables unchanged, and import the reviewed **complete** schema. The client schema alone does not configure remote permissions.
2. Verify that `rlm-public` remains public-readable and only the database owner / GLOBAL_WRITE service credentials may mutate it. Never put publication credentials in the TMA, its Worker token-exchange service account, ordinary repository Actions secrets, or frontend code. **Approved operator exception:** a separate `ACCESS_DB,GLOBAL_READ,GLOBAL_WRITE` publication service-account key may be stored only as the `DEXIE_CLOUD_WRITE_KEY` secret of the protected GitHub Environment `dexie-production`. This environment must be restricted to `main` and configured with required reviewer approval before any publish run. The workflow must be manual-only, owner-restricted, with explicit confirmation; it must not run on push/merge. Existing diagnostic `DEXIE_CLOUD_KEY_JSON` stays read-only.
3. Upload the canonical unmodified JSON to the chosen private R2 bucket under the exact content-addressed key above using the operator's `wrangler r2 object put` command. Download the same key back to an admin workstation using `wrangler r2 object get` and verify its SHA-256.
4. Export public Dexie Cloud data before staging: `npx dexie-cloud export --legacy --realmId rlm-public previous-public.json`. For a positively verified brand-new empty public realm, the script accepts `--assume-empty` instead of `--previous`.
5. Prepare the initial import from the downloaded R2 file: `node tools/exercises/prepare-public-catalogue.mjs --source /secure/path/source.json --previous previous-public.json --out-dir /secure/path/prepared`. Review `diff-report.json`; **no missing ID is automatically deleted**. Source consistency notes for nine records are unchanged.
6. Import `/secure/path/prepared/01-stage.json` with `npx dexie-cloud import` under an **administrative identity**.
7. **Export public data again**, e.g. `npx dexie-cloud export --legacy --realmId rlm-public staged-public.json`, then verify: `node tools/exercises/prepare-public-catalogue.mjs --source /secure/path/source.json --verify-export staged-public.json`. If incomplete, do not activate.
8. Import `/secure/path/prepared/02-activate-after-verification.json` and confirm live devices synchronize 1324 records and 69 taxonomy nodes. Publication manifest must be imported **last**. The public catalogue stays unavailable until this step.

`--previous` is mandatory for a non-empty environment: the importer refuses a different active source SHA. A future catalogue update needs dedicated versioned publication design. A first import is staged but is **not** a multi-table atomic Dexie Cloud transaction; a verifier + final publication manifest prevents showing partial data. Existing data is never deleted in PR1.

## Access / offline

- `rlm-public` permits unauthenticated reads at Dexie Cloud level. This PR does not add anonymous entry into the Telegram Mini App, which still authenticates for its private flows.
- On an already-synced device, catalogue reads, search and taxonomy filtering are local and continue offline.
- A newly installed device needs online sync. Missing initial sync and intentionally unpublished catalogue must not be misrepresented as an empty exercise library.
- Category images from `/gym-keeper/categories` remain deferred pending their own rights review. Existing owner-approved exercise GIFs are served via the established Worker/R2 route for the pinned Dexie Cloud catalogue; absent media still uses the UIkit icon fallback. No new media are imported by this integration.

## Deferred

Legacy D1 workout exercise pickers, personal exercises, favourites, coach-client sharing, assignment, historical snapshots, PLAN, FACT, R2 image delivery, automatic deletions and future version migrations.
