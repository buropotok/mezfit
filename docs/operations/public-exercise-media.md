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
  in the legacy D1 media index, resolves its validated active import version
  and reads the corresponding R2 GIF at
  `exercise-media/github_exercises_dataset/versions/<import-sha>/<id>.gif`.
  The Worker returns 404 if the media is missing or unapproved by its
  own index. The new catalogue never constructs a raw R2 URL or trusts the
  metadata `gif_url` as a downloadable external address.

This **does not reintroduce D1 as the business database**: D1 remains the
pre-existing GIF index for the existing Worker endpoint only. The workout
catalogue, taxonomy and manifest remain authoritative in Dexie Cloud.
No additional background sync and no client-side media URL database exist.

## Licensing gate — disabled by default

`docs/architecture/public-exercise-catalogue-pr1.md` intentionally keeps
the media surfaces as placeholders until redistribution permissions are
verified. Merely having third-party GIF objects in private R2 does **not**
establish the right to publicly serve them.

This PR wires the UI but remains disabled by default. Only after the product
owner has verified rights/permission and the approved media source should the
operator set the GitHub Actions **repository variable**
`VITE_PUBLIC_EXERCISE_MEDIA_APPROVED=true` and redeploy the application.
The variable is evaluated at build time by Vite; changing it alone without a
new deployment will not update the running application. Setting the flag is
an explicit operator rights approval, **not** an automatic consequence of
merging the PR.

Before enabling, verify that the old D1 index and existing private R2
objects still correspond to the same 1324-record source. Confirm the deployed
Worker returns a valid `image/gif` for representative IDs (including IDs
from different categories). A missing object results in the existing barbell
fallback rather than a broken image.

The flag must remain unset/false until permissions are established.
This is a **UI rollout switch, not authorization**: the pre-existing Worker
media route is independently public and requires its own licensing/security
review. Disabling the new UI does not make that existing endpoint private.
No images are uploaded by the PR. Thumbnails use lazy loading; the detail
GIF loads eagerly. No third-party host URLs are exposed to browsers. GIFs
remain external to the IndexedDB local-first catalogue; offline exercise text
continues to work even if uncached media cannot be displayed.

The existing Worker and original `ExerciseMedia` component for legacy
surfaces remain unchanged. Once a future approved media source or
content-addressed backend replaces the D1 mapping, make that a separate,
reviewed media-transport migration.
