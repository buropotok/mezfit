# COMM media: dual-upload iteration (Yandex + Cloudflare R2)

**Scope / approved contract:** 2026-11-15 owner-approved first
iteration of dual uploads to Yandex Object Storage and the dedicated Cloudflare
R2 media bucket. Cloudflare infrastructure bootstrap has already created
`mezfit-discussion-media`, configured CORS and generated bucket-scoped credentials;
this code PR only adds the Worker binding and signer/client upload path.
The root AGENTS.md media exception and COMM-09 documentation are updated in this
same PR. No GitHub Environments, D1/Dexie Cloud migrations, ACL edits or new
Cloudflare resources are required.

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
  `mezfit-discussion-media.<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/mvp-media/...`.
  Signed headers: `content-length;content-type;host;if-none-match`. The File
  bytes go straight to the R2 S3 endpoint, **never through the Worker**.
- The PUT is write-once (`If-None-Match: *`). If the response is lost and a
  retry returns 412, the client requests
  `POST /api/discussion-media/verify`. The Worker uses its dedicated `R2_BINDING_DISCUSSION_MEDIA` binding
  to check size and MIME by HEAD. A collision with different metadata is a
  failure, not a success. Both endpoints require fresh Telegram `initData`.
  The typed `src/api.ts` transport owns privileged Worker route construction,
  request serialization and response validation; the R2 upload adapter checks
  the signed URL's bucket/key/headers again before sending bytes.
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
not require a DiscussionSheet to remain open. Missing provider replicas are
attempted independently so a stalled Yandex recovery does not delay R2.
A partial or evicted local cache cannot reconstruct the source bytes; it
is not silently treated as successful.

These local timestamps are **hints of earlier successful writes**, not claims
that the cloud object still exists. Retry after an ambiguous outcome uses the
same key and verifies a 412. There is no independent message-sync engine.
Remote replica timestamps in `flexAttributes/flexValues` and cross-device
retry coordination are **not part of the first upload iteration**.

## Important MVP limitation

**This iteration does not change media reading.** Existing playback URLs still
point to Yandex. The owner confirmed that all current users are test users
and explicitly removed the Telegram ID allowlist. Any user with verified
Telegram `initData` can request a signed R2 upload or object verification;
invalid/expired Telegram authentication, invalid upload parameters and
cross-origin calls remain forbidden.

**Known MVP failure mode:** If the first and only successful upload is to R2,
the message is marked sent but its Yandex playback URL does not resolve.
The recipient will be unable to view the media until Yandex upload recovery
succeeds or a separate R2 read-fallback iteration is implemented.
Use non-sensitive disposable files for testing; a green test suite does not
replace Android/iOS Telegram WebView acceptance (VPN and video Range included).

## Provisioned Cloudflare infrastructure and testing gates

1. **Already provisioned:** R2 bucket `mezfit-discussion-media`, scoped R2 S3
   token and Worker secrets `R2_MEDIA_ACCESS_KEY_ID`,
   `R2_MEDIA_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`. The GitHub bootstrap
   completed successfully on 2026-11-15. This PR adds the
   `R2_BINDING_DISCUSSION_MEDIA` Worker binding and does not modify the
   unrelated GIF bucket `mezfit` / `R2_BINDING_MEZFIT`.
2. CORS for the dedicated bucket is configured for the Mini App HTTPS origin,
   including PUT with `Content-Type` and `If-None-Match`, plus GET/HEAD and
   Range in preparation for a separate read fallback. The browser sets
   Content-Length and Host itself; they are bound to SigV4.
3. **MVP without allowlist:** R2 sign/verify is available to every user
   who passes Telegram `initData` verification. No Telegram ID repository
   secret or additional Cloudflare bootstrap is required. Retain server-side
   request validation, write-once conditional PUT and bucket-scoped credentials.
   Users should test with disposable media because R2 read fallback is not
   implemented yet.
4. Verify signed conditional PUT, a 412 retry/HEAD against the dedicated
   bucket, permission and key boundaries, full-size videos, WebView CORS,
   VPN routing and lack of credential exposure. The CI tests cover only
   simulated transports, not live R2 S3/WebView behavior.
5. Existing Yandex Function, Yandex bucket and public GET reading remain
   unchanged. No public R2 WRITE/LIST/DELETE and no public R2 READ is enabled.

### Intentionally outside the first iteration

- R2 fallback for viewer, thumbnails, streaming and Range.
- FlexAttribute materialization of replica status across devices.
- Automated cloud-to-cloud copying, background work after Telegram WebView
  suspension, object deletion/retention and orphan cleanup.
- Changes to Telegram avatar and exercise media storage.
