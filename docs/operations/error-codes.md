# Mezfit support error codes — initial registry and audit

**Format:** Every newly migrated user-visible error ends with `(Код: STABLE_CODE)`.
The explanation remains in Russian; the code is stable, ASCII uppercase, without
identifiers or runtime values. Constants and formatter: `shared/app-error-codes.ts`.

## Existing coding families (audit of main, 2026-11-19)

| Existing family | Current owner | Current state |
| --- | --- | --- |
| Numeric `Код 1` … `Код 12` | `src/discussions/useDiscussionMedia.ts` | Migrated to semantic `MEDIA_SEND_*` |
| `ADHOC_*` | `src/workout/adhoc-workout-errors.ts` | Retained; already embeds business validation IDs |
| Numeric organization diagnostics | Discussion inbox / organization | Retained, not converted to unrelated media codes |
| `HTTP_4xx/5xx`, `NETWORK_ERROR`, `CLOUD_LICENSE`, `OTHER_SYNC_ERROR` | Dexie sync diagnostic | Retained for infrastructure compatibility |
| `RECORDER_*`, `WEBM_*`, `CAMERA_*` | `shared/video-recording-diagnostic.ts` | Retained, now also displayed on recorder errors |
| File probe, video review, voice recording | media / recording owners | New `MEDIA_*`, `VOICE_*` codes |

### Legacy numeric crosswalk

| Old code | New code |
| --- | --- |
| 1 | MEDIA_SEND_NETWORK_SIGNER |
| 2 | MEDIA_SEND_NETWORK_PUT |
| 3 | MEDIA_SEND_NETWORK_HEAD |
| 4 | MEDIA_SEND_NETWORK_OTHER |
| 5 | MEDIA_SEND_TIMEOUT |
| 6 | MEDIA_SEND_AUTH |
| 7 | MEDIA_SEND_SIGNER_UNAVAILABLE |
| 8 | MEDIA_SEND_STORAGE_HTTP |
| 9 | MEDIA_SEND_STORAGE_UNKNOWN |
| 10 | MEDIA_SEND_LOCAL_SAVE |
| 11 | MEDIA_SEND_MESSAGE |
| 12 | MEDIA_SEND_CANCELLED |

## Operational rules

- Codes classify one failure condition, not one user, file, HTTP URL, or device.
- Business validation (wrong format, excessive size, intentional cancellation)
  is displayed with a code but is **not** sent as an incident.
- Runtime media errors and unexpected transport/storage failures are sent using
  the existing signed `/api/diagnostics/video-recording` route. This route now
  also accepts the allowlisted `media` and `voice` profiles.
- Never report text, filenames, message IDs, access tokens, URLs, Telegram IDs,
  source media, stack traces or unfiltered exceptions. Server validates allowlists.
- A diagnostic rejection must not stop the user's operation.
- Existing backend machine-readable errors remain unchanged. They should be
  mapped explicitly at a UI boundary rather than appended to raw backend text.

## Subsequent migration inventory

The repository has additional presentation-level error handling beyond the
communication/media/recorder flow, including program editing, calendar,
scheduling, exercise catalogues, Coach/Client profiles and invitations. Their
error names and retry semantics require **domain-owned mapping**; a global catch
or interception of Konsta `Text`, `Toast`, `Message` or `role=alert` is
forbidden. The first migration intentionally does not change their behavior or
emit notifications for ordinary offline/expected local-first conditions.

Before migrating those modules, inventory each user-visible failure by owner,
keep existing recovery paths and add explicit structured identifiers to the
allowlisted telemetry protocol. Do not log unrelated expected sync transitions.
