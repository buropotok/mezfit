# R2-only media upload smoke test (temporary MVP deployment)

## Purpose

Verify that a new discussion attachment can be **sent and stored in the private
Cloudflare R2 bucket `mezfit-discussion-media`** when the Yandex media signer
is deliberately unavailable. This tests the existing upload fallback, **not**
R2 read fallback. All current Mezfit users are test users; use disposable media.

## Scope and safety

- Do **not** disable the Yandex Cloud Function, delete Yandex objects, remove
  S3 credentials, change bucket ACLs, or alter the original
  `VITE_YANDEX_MEDIA_FUNCTION_URL` repository variable.
- A manual GitHub Actions **Deploy Mezfit** run with
  `r2_only_media_test = true` compiles an intentionally invalid Yandex
  *signer* URL into the Mini App. The existing Yandex uploader immediately
  reports `SIGNER_UNAVAILABLE`, and the dual-upload orchestrator falls back
  to Cloudflare R2 with the same `mvp-media/<64 hex>` storage key.
- Existing Yandex **reads remain enabled**. Newly sent **R2-only** media
  produces a Yandex playback URL that does not resolve until Yandex replication
  succeeds or R2 read fallback is implemented. **Do not rely on the recipient
  being able to open the new attachment.** This is a test of upload and
  publication only.
- This mode affects all current users of the deployed Mini App while enabled.
  An ordinary push-triggered deployment or a manual deployment with the
  input set to `false` restores the existing Yandex upload configuration.

## Run the smoke test

1. Merge the reviewed PR that adds the `r2_only_media_test` input.
   Do not merge until its required CI is green.
2. In GitHub Actions open **Deploy Mezfit** → **Run workflow**.
   Choose branch `main` and enable **Disable new Yandex media uploads for a
   temporary R2 fallback smoke test**.
3. Confirm the workflow finishes successfully, especially
   `npm run build` and `Deploy Worker`. The Worker retains
   `R2_BINDING_DISCUSSION_MEDIA`. No additional Cloudflare bootstrap is needed.
4. Reopen the deployed Mini App inside Telegram to load the new build. Send a
   new, uniquely identifiable **small, disposable photograph** in a discussion.
   Record the message's result and time. Do not send private media.
5. Check the Cloudflare dashboard → R2 → `mezfit-discussion-media` → Objects
   for a newly added `mvp-media/<64 hex>` object after the send. Verify size
   and approximate creation time. This is the primary evidence of R2 upload.
6. Check the Yandex bucket `mezfit-comm-poc-20261106` → `mvp-media/` for
   the **same storage key**. It must **not** exist as a new Yandex object
   during the test. Existing Yandex objects must remain unchanged. A failure
   to open the attachment in another account is currently **expected** and is
   not evidence of failed R2 storage.

**Pass criterion:** the message is accepted, the fresh object exists in
`mezfit-discussion-media`, and the same key is absent from Yandex.

**Fail criterion:** R2 signing/PUT fails, the message is rejected, or the same
new object appears in Yandex despite the test deployment.

## Restore normal dual upload

1. In GitHub Actions run **Deploy Mezfit** again on `main` with
   `r2_only_media_test = false` (default). Confirm the deployment finishes.
2. Reopen the Telegram Mini App and send another **new** disposable picture.
   Confirm that its object appears in both Yandex and R2 again.
3. Do not delete the test photo from R2 merely to make the result match
   expectations; preserve it until the smoke-test outcome is recorded.

No test requires changing production Yandex configuration or setting
`R2_MEDIA_TELEGRAM_ALLOWLIST`. Telegram authentication and private R2
credentials remain mandatory.
