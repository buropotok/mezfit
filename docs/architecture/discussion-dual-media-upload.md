# COMM media: dual-upload iteration (Yandex + Cloudflare R2)

**Scope / approval:** 2026-11-15 owner request for the first iteration of uploads to
both object stores. This document is an additive exception to the original
COMM-09 Yandex-only transport. **No cloud configuration is applied by this PR.**
The owner must separately approve changes after a read-only inventory of existing
Cloudflare R2 resources, credentials and bucket CORS.

## Transport and user-visible delivery

- A single `mvp-media/<64 hex>` key, attachment ID, Telegram-authenticated actor,
  MIME and byte count are reused for both providers. Dexie Cloud remains the sole
  business data store; no second message or attachment is created.
- The device attempts the existing signed Yandex PUT first. A successful Yandex
  upload is sufficient to publish the message and starts an independent R2 copy.
  If Yandex fails, R2 is attempted. If Yandex has not replied in eight seconds,
  R2 may start in parallel to avoid hanging behind an unreachable VPN route.
  The first verified provider success unblocks `DiscussionRepository.send`.
  Failure of one provider does not roll back the other.
- The Cloudflare Worker `POST /api/discussion-media/sign` authenticates the
  Telegram `initData`, validates the exact key, MIME and max byte length, and
  returns a short-lived (600s) SigV4 PUT for
  `mezfit.<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/mvp-media/...`.
  Signed headers: `content-length;content-type;host;if-none-match`. The File
  bytes go straight to the R2 S3 endpoint, **never through the Worker**.
- The PUT is write-once (`If-None-Match: *`). If the response is lost and a
  retry returns 412, the client requests
  `POST /api/discussion-media/verify`. The Worker uses its existing R2 binding
  to check size and MIME by HEAD. A collision with different metadata is a
  failure, not a success. Both endpoints require fresh Telegram `initData`.
  No client credentials, shared secrets or R2 write tokens are shipped to a browser.
- Yandex's existing signer, bucket ACL and public-read URL contract remain
  unchanged; Cloudflare does not proxy or rewrite those requests.

## Local recovery

The same account-scoped IndexedDB media cache now has a `replicas` store.
An operational row holds key, MIME, size, filename, Yandex/R2 confirmation
timestamps and `published`. It is marked published only after the existing
Dexie discussion repository has committed the attachment. The actor's
`DiscussionsProvider` retries missing providers after a fresh app session,
`online` or `visibilitychange`, using the locally cached File. Uploads do
not require a DiscussionSheet to remain open. A partial or evicted local cache
cannot reconstruct the source bytes; it is not silently treated as successful.

These local timestamps are **hints of earlier successful writes**, not claims
that the cloud object still exists. Retry after an ambiguous outcome uses the
same key and verifies a 412. There is no independent message-sync engine.
Remote replica timestamps in `flexAttributes/flexValues` and cross-device
retry coordination are **not part of the first upload iteration**.

## Important rollout limitation

**This iteration does not change media reading.** Existing playback URLs still
point to Yandex. If the first and only successful upload is to R2, the message
will be marked sent but the recipient cannot open the media until a subsequent
read-fallback change is enabled. Therefore **do not activate R2-only publication
for general users until the paired read-fallback iteration is complete.**
Restrict initial Cloudflare testing using `R2_MEDIA_TELEGRAM_ALLOWLIST` and test
with disposable files/accounts. A green test suite does not replace an Android
and iOS Telegram WebView acceptance test (including VPN and video Range).

## Cloudflare configuration to apply only after separate owner approval

1. Inventory existing `mezfit` R2 bucket, binding `R2_BINDING_MEZFIT`, public
   access, existing objects and CORS. The first iteration uses only the
   `mvp-media/` key prefix inside this **existing bucket**. A dedicated media
   bucket/token is preferable for production isolation but is not provisioned here.
2. Create a restricted R2 S3 API token scoped to that bucket and use Worker
   secrets `R2_MEDIA_ACCESS_KEY_ID` and `R2_MEDIA_SECRET_ACCESS_KEY`.
   Set `R2_ACCOUNT_ID` (32 hexadecimal characters). Token scopes must not
   include account administration or other buckets. The Worker signs only
   validated `mvp-media/` keys; S3 credentials themselves are bucket-scoped.
3. During closed testing set `R2_MEDIA_TELEGRAM_ALLOWLIST` to comma-separated
   numeric Telegram IDs. Deny requests from other identities.
4. Set the existing bucket's CORS origin to the exact deployed HTTPS Mini App
   origin, and permit PUT with `Content-Type` and `If-None-Match`; read
   `ETag` where useful. A browser sets `Content-Length`/Host automatically,
   not via JavaScript. Read/Range CORS is a later phase. Never enable public
   PUT, LIST, DELETE or ACL modification.
5. Verify signed conditional PUT, 412 recovery, permission boundaries,
   full-size supported videos, mobile headers, VPN connection behavior and
   no exposure of credentials. Inspect the old bucket policies before
   making any change to shared `mezfit` configuration.

### Intentionally outside the first iteration

- R2 fallback for viewer, thumbnails, streaming and Range.
- FlexAttribute materialization of replica status across devices.
- Automated cloud-to-cloud copying, background work after Telegram WebView
  suspension, object deletion/retention and orphan cleanup.
- Changes to Telegram avatar and exercise media storage.
