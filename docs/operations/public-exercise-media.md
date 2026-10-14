# Media in the Dexie Cloud public exercise catalogue

The canonical public catalogue is already in Dexie Cloud. This change reuses
an **existing** GitHub Exercises Dataset GIF pipeline. It does not import or
republish the catalogue, upload media, rewrite Dexie rows, or introduce an
unrestricted media proxy.

## Resolution contract

- Exercise data/authorization: `publicExerciseDefinitions` in Dexie Cloud,
  synced to the local IndexedDB by the existing repository.
- Metadata identity: a canonical release 2.0.0 row with a four-digit `id`,
  a nonempty `gif_url` and the pinned SHA-256
  `5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c`.
- Media transport (already deployed):
  `/api/exercise-media/gym_keeper_apk/<four-digit id>`.
- The Worker looks up the same canonical dataset ID under
  `exercise_definition.reference_source = 'github_exercises_dataset'`
  in the legacy D1 media index, verifies the **exact** approved import version
  supplied as `?v=7455efae41b330c265e7cd4b78dfa848e7ce5ebd`, then reads
  the R2 GIF at
  `exercise-media/github_exercises_dataset/versions/7455efae41b330c265e7cd4b78dfa848e7ce5ebd/<id>.gif`.
  The Worker returns 404 if the requested version is not the active D1
  version, or if its R2 object is absent. The new catalogue never constructs a raw R2 URL or trusts the
  metadata `gif_url` as a downloadable external address.

This **does not reintroduce D1 as the business database**: D1 remains the
pre-existing GIF index for the existing Worker endpoint only. The workout
catalogue, taxonomy and manifest remain authoritative in Dexie Cloud.
No additional background sync and no client-side media URL database exist.

## Preventing silent upstream version changes

The pinned 40-character media import commit is
`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`, read from
`shared/approved-exercise-media.json`. The last verified successful
import (GitHub Actions run #34648109940, 2026-09-11) activated all 1324
GIFs from this commit. Re-running the importer does **not** fetch a moving
upstream HEAD: it checks out this revision explicitly and refuses a
different SHA.

`.github/workflows/import-exercise-media.yml` no longer runs on
`Deploy Mezfit` completion. An import requires manual `workflow_dispatch`
by the repository owner on `main`, with confirmation
`IMPORT_PINNED_1324`. A later dataset version needs a separate reviewed
PR updating the approved commit, source mapping, rights and corresponding
Dexie catalogue. The frontend will not silently switch if the D1 media
index somehow activates a different revision; the Worker responds 404
and the UI uses a fallback.

This change relies on the last successful import log to identify the
previously activated version. It does **not** independently audit the current
private R2 bucket or D1 table contents. If the media endpoint returns 404
for representative IDs, confirm those backing records match the pinned
revision before considering a new import.

## Owner authorization and automatic rollout

On 2026-10-13 the product owner explicitly confirmed that the previously
uploaded GIF library belongs to them ("Это мои гиф") and approved reuse in
Mezfit without reuploading the files. This records the product owner's
authorization for the **existing exercise GIF collection in R2**, not for
unrelated Gym Keeper category illustrations or third-party media downloads.
No independent legal or third-party licence verification is asserted here.

The production UI requests an exercise GIF **automatically** when the synced
row has the approved immutable release SHA, a valid four-digit ID and a
nonempty `gif_url`. There is **no build-time approval flag** and no manual
repository variable to configure. After PR merge and successful normal
`main` deployment, the UI uses the same-origin Worker endpoint.

The existing Worker media route is public independently of this UI change;
frontend gating is not a security control. Before interpreting an absent GIF
as a UI regression, check that the existing D1 media index and private R2
objects still correspond to the previously imported 1324-record source. The
Worker must return a valid `image/gif` for representative IDs. Missing
objects return 404 and display the fallback icon or "Медиа недоступно" —
the catalogue text and navigation remain unaffected.

No images are uploaded by this PR. Thumbnails use lazy loading; the detail
GIF loads eagerly. No direct R2 URLs or third-party hosts are exposed to
browsers. GIF bytes remain outside the IndexedDB local-first store; offline
exercise text continues to work even when the GIF is uncached.

The existing Worker and original `ExerciseMedia` component for legacy
surfaces remain unchanged. Once a future approved media source or
content-addressed backend replaces the D1 mapping, make that a separate,
reviewed media-transport migration.
