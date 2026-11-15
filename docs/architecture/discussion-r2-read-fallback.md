# COMM-09: private Cloudflare R2 read fallback (second iteration)

## Scope and transport

The existing **Yandex-first, R2-second uploads** remain unchanged. For reading
published discussion photos, videos, voice clips and video circles, the Mini
App tries the existing Yandex URL or its account-scoped IndexedDB cache first.
On a failed GET / native media load it requests `POST /api/discussion-media/read`
through the typed `src/api.ts` transport and switches to a **short-lived
private, SigV4-signed R2 GET URL**. The Worker never proxies the file bytes.

The new POST accepts the Telegram `initData`, storage key, MIME, exact size and
`realmId`, `messageId`, `attachmentId`. All are treated as untrusted.
The Worker independently verifies:

1. Fresh cryptographically verified Telegram initData (actor `tg:<id>`).
2. Current accepted Coach/Client membership in the specified Dexie Cloud realm,
   using the existing read-only `DEXIE_CLOUD_REMINDER_CLIENT_ID/SECRET`
   Worker secrets and the validated relationship contract.
3. The exact published, undeleted message and `ready` attachment in that same
   realm, with matching message owner/author, key, MIME and size.
4. Matching metadata on the private R2 object via
   `R2_BINDING_DISCUSSION_MEDIA.head(storageKey)`.

No membership, incorrect attachment, missing read-only service credentials,
stale/unsynchronized cloud data or provider failure: **deny the R2 capability**.
The client never receives the Dexie read-only token or R2 signing secret. A presigned URL necessarily contains the non-secret R2 access-key identifier.
This mechanism never grants broader permissions in Dexie Cloud and does not
create any D1 or independent business metadata.

## Browser playback and caching

- R2 SigV4 GET expires after **600 seconds** and signs only `host`, allowing
  the native browser to send `Range` for MP4 and audio seeks. R2 remains
  private: there is no public read/list/write and no shared permanent R2 URL.
- The signed URL must match the exact dedicated R2 bucket host/key/algorithm;
  otherwise the browser refuses to load it. The old GIF R2 bucket is forbidden.
- Small photos and locally downloaded clips are checked for exact byte length
  and MIME, then cached in the account-scoped Dexie/IndexedDB media store.
  Large video thumbnails do **not** eagerly download the complete video.
  Native media elements use the signed URL on failure and can stream/seek.
- The viewer cancels stale async results on unmount or switching attachments,
  and exposes an explicit Retry action if the signed URL expires or neither
  provider can deliver the media.
- The audio/video original codec limitations remain; R2 does not transcode.

## Deployment and acceptance

The second iteration reuses the provisioned `mezfit-discussion-media` bucket,
R2 object read/write token, Worker binding, CORS (GET, HEAD, Range),
Telegram bot secret and existing **read-only Dexie Cloud reminder account**.
Verify those two Dexie Cloud service credentials are present in the deployed
Worker. No new Cloudflare resources, R2 public permissions, Dexie Cloud ACL
changes or schema migrations are approved.

After green CI and deploy:

1. Use non-sensitive images, videos, voice clips and video circles, from both
   Coach and Client accounts with a fully synchronized discussion.
2. Confirm Yandex-primary playback continues to work without new R2 signing
   requests when Yandex is healthy.
3. Make Yandex **reads** temporarily unavailable without deleting objects or
   changing the Mini App build. Confirm a new/previous R2-backed photo and
   video open and seek from R2; verify a `200` signed GET and native `206`
   `Range` requests in DevTools where available.
4. Verify a relationship outsider or a deleted/non-ready attachment cannot
   acquire a read capability (`403` or `404`); never paste signed URLs or
   Telegram initData in chat/logs.
5. Re-enable Yandex reads, reopen the Mini App and confirm it again remains
   the primary source. Test Android/iOS Telegram WebView, both VPN states,
   long pauses/expired signatures, lazy thumbnails and downloads.

The previous dual-upload rollout was tested with real Yandex/R2 writes.
**CI and code review cannot establish successful real-world R2 reads** until
these acceptance steps have been completed.
