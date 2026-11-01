# Public category artwork delivery — Dexie Cloud Blob Storage

## Product invariant

The eight category illustrations are **not** requested through Cloudflare Assets,
Worker, D1, R2 or any other media endpoint at runtime. They are stored in
Dexie Cloud Blob Storage and synchronized through the existing authenticated
Dexie Cloud Addon. The device's IndexedDB subset is the source for React.
The ninth category, `other`, retains the existing local UI Kit fallback.

## Publication

The checked-in WebP/SVG files under `public/` are **operator inputs only**.
The source allowlist is `cloud/category-artwork.json`; the target is exactly
`publicExerciseCategoryArtworks`, with eight stable IDs `category-artwork:<category>`
in `rlm-public`, `owner: null`. Each row includes the SHA-256 of its original
bytes, MIME, byte size and a cloud BlobRef. No ordinary user can publish or edit
the public rows.

The existing `DEXIE_CLOUD_WRITE_KEY` environment secret is sufficient to request
`ACCESS_DB`, `GLOBAL_READ`, `GLOBAL_WRITE`. The credential is never bundled
into the Mini App, copied to a PR job or exposed in logs. There is **no new key**.
The new manual-only `.github/workflows/publish-category-artwork.yml` runs only
for the repository owner on `main`, behind required `dexie-production`
environment approval. Preview does not mutate. Apply requires the literal
confirmation `PUBLISH_PUBLIC_CATEGORY_ARTWORK_V1` and uses the same
protected-writer concurrency lock as the catalogue publisher.

The workflow first adds only the missing cloud table, verifies the complete
schema and unchanged roles after import, then uploads only missing Blob IDs
to `/blob`, attaches each BlobRef to the public table via `/all`, and
reads back all eight binary objects to verify SHA-256. Unexpected existing
rows or differing bytes fail closed, and re-running after partial publication
resumes only truly missing records. No remote existing row is deleted or
silently overwritten. No schema or media publication happens on PR or push.

## Rollout

1. Merge the implementation after PR review and CI.
2. From `main`, manually run the protected workflow with `preview`.
3. With required environment approval, select `apply` and enter the exact
   confirmation. Inspect the reported verification of all eight files.
4. Verify on an authenticated Telegram Mini App device that all eight
   public BlobRefs resolve to local Blobs, including after a restart/offline.

The Mini App may temporarily show its existing fallback icons before step 3
or while Blob hydration is pending; it never falls back to Cloudflare media.
Initial login and first Blob download require connectivity. The operating
system may evict IndexedDB; the Addon then downloads the blobs again.
The app's HTML/JS hosting remains separate from category media delivery.
