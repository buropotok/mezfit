# COMM-09 media gateway

The existing `mezfit-media-gateway` function uses the private
`mezfit-comm-poc-20261106` bucket and the existing main-scoped OIDC federation.
The workflow verifies the function ID and folder, reconciles CORS and expiry of
pending uploads, then publishes a Node.js 22 version. A relevant push to main
runs deployment automatically. Workflow dispatch on main can retry deployment.

| Repository variable | Purpose |
| --- | --- |
| `YC_DEPLOY_SA_ID` | Existing OIDC deploy identity |
| `YC_RUNTIME_SA_ID` | Existing function runtime identity |
| `YC_FUNCTION_ID`, `YC_FOLDER_ID` | Expected function and folder |
| `MEDIA_ORIGIN` | Exact HTTPS Mini App origin |
| `YC_MEDIA_SECRET_ID`, `YC_MEDIA_SECRET_VERSION_ID` | Lockbox references |

Lockbox must provide `telegram-bot-token` and a stable random
`media-provenance-key` of at least 32 characters. Preserve the provenance key
when rotating the bot token. Replacing it invalidates existing object proofs.
The workflow uses secret references and keeps the main-branch OIDC subject.

The documented runtime role, `storage.uploader`, excludes object deletion.
The runtime needs object deletion scoped to `media/objects/*`, access to write
and read revocation markers under `media/revoked/*`, and access to the referenced
Lockbox payload. The deploy identity needs read and update access to CORS and
lifecycle on this bucket. The Mini App also needs HTTPS invocation access to the
existing function. For direct invocation this requires
`serverless.functions.invoker` for `allUsers` on this function alone, with user
authentication enforced by the handler. The deployment workflow leaves these
bindings for the resource owner. The existing storage bucket stays private.
Existing budget alerts are notifications. Function execution, storage, traffic
and Lockbox use can incur charges.

## Gateway request contract

POST JSON with `operation`, `realmId`, `threadId`, `messageId`, and
`attachmentId`. Send `Origin`, `x-telegram-init-data` and
`Authorization: Bearer <ordinary Dexie user access token>`. The handler
verifies Telegram and binds the Dexie token subject to the same user. Dexie
`/my` reads and canonical membership checks establish access to the exact pair
and discussion. An object proof also binds the thread anchor, attachment,
author and media metadata.

| Operation | Contract |
| --- | --- |
| `upload-intent` | Author provides filename and base64 MD5 for a pending attachment already visible in Dexie. Receives PUT URL, exact headers, proof, key and expiry. |
| `confirm` | Author sends proof. The gateway verifies HEAD metadata, length, ETag, and the file header. It returns 202 with the attachment confirmation DTO until the matching ready record has synchronized in Dexie. A repeat confirm returns 200 after readback and retention. |
| `read` | A participant with access to the ready attachment receives a GET URL. Object Storage serves video byte ranges directly. |
| `remove` | Author revokes the object key and deletes the bytes. If deletion fails after revocation, the same request can complete it later. |

COMM-10 should persist pending attachment metadata through the local repository,
upload with all signed headers, apply the confirmation DTO through the local
repository, and retry confirm after Addon synchronization. Keep the proof for
upload retries. Within one hour of issuance, requesting a fresh PUT URL with
the same proof preserves the object key. A new attachment is needed after that
window. Both URL types have a 120-second TTL. The client keeps signed URLs
transiently. Never put URLs, bot tokens, or credentials in Dexie or logs.

A signed conditional PUT prevents replacement of an existing object. The
gateway checks the actual size after upload, with caps of 20 MiB for photos,
250 MiB for video and 25 MiB for voice. PUT can still temporarily store an
oversized upload before confirmation rejects it. Header inspection validates
the expected container signature. Duration limits use the recorded metadata.
The pending-object lifecycle expires abandoned uploads after one day. Ready
objects are promoted out of that lifecycle rule. Confirmed media retention
policy belongs to COMM-13. A revocation marker prevents a replayed PUT from
restoring access. An already-issued URL can remain usable for its remaining TTL.

## Verification and rollback

PR CI checks the gateway through mocked upstream responses, including the
compiled function artifact. Verify real Dexie user tokens, Yandex signing,
conditional PUT, Range, CORS, removal and device connectivity on disposable
fixtures after deployment. Existing COMM-02 transport diagnostics cover a
separate path.

If necessary, restore the previous reviewed function version and revert the
main change. Restore previous CORS and lifecycle settings from the owner's
deployment configuration. Preserve revocation markers and private bucket access.

References: [Yandex IAM and Object Storage](https://yandex.cloud/en/docs/storage/api-ref/authentication),
[PresignService](https://yandex.cloud/en/docs/storage/api-ref/grpc/Presign/create),
[Bucket.Update](https://yandex.cloud/en/docs/storage/api-ref/Bucket/update),
[Dexie Cloud REST API](https://dexie.org/docs/cloud/rest-api).
