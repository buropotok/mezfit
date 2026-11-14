# Temporary Telegram alerts for video recorder failures

The Telegram Mini App sends a **best-effort technical diagnostic** when the shared
video-note recorder cannot start or complete a capture. The alert uses the existing
Cloudflare Worker and Telegram bot. It does **not** send a video, recording audio,
chat text, message/thread IDs, source URLs, session tokens, phone numbers,
Telegram usernames, or participants' Telegram IDs.

## Recipient and lifecycle

- `VIDEO_RECORDING_REPORT_CHAT_ID` in the Worker environment selects the private
  Telegram destination. The temporary recipient is configured through
  `wrangler.jsonc`. The recipient must open `@mezfit_bot` and press **Start**.
- Remove the variable from Worker configuration and redeploy to **disable** all
  outbound diagnostic messages. Without the variable the server fails closed
  with HTTP 503, and the client ignores delivery failures.
- The existing server-side `TELEGRAM_BOT_TOKEN` remains the only bot credential;
  no bot token or destination ID is embedded in the Mini App bundle.
- This feature requires no D1 schema, Dexie migration, or new cloud permission.

## Diagnostic content

The visible header shows the error category, recorder profile, Telegram platform
and UTC timestamp. A Telegram HTML `<blockquote expandable>` contains:

- all exact H.264/MP4 MIME capability checks plus WebM comparison results;
- user-agent string (typically includes Android/WebView versions and device model),
  Telegram platform/API version, browser brand hints, screen/viewport, DPR, color depth;
- browser camera/MediaRecorder/WebCodecs availability and supported constraints;
- optional CPU core count, memory and coarse network information when exposed;
- the non-identifying actual camera frame dimensions/rate/facing and recorder
  MIME/bitrate/size/duration on failure.

Neither `navigator.mediaDevices.enumerateDevices` nor device/group IDs are read.
Do not add IP address, location, identity values, freeform error stacks/messages,
chat content, uploaded media, or Telegram initData to the report.

Client delivery is de-duplicated for five minutes per error/profile. The server
verifies signed Telegram initData, accepts only allowlisted structured fields,
bounds input size and output text, applies a per-actor short rate limit within
each Worker isolate, and forwards directly to the configured bot chat. The rate
limit is a temporary flood reduction, **not** a distributed abuse-control
guarantee. Failure to send the alert never blocks camera or chat UI.

## Compatibility

The shared camera recorder probes explicit H.264 variants and generic MP4 first.
If no MP4 format is usable or a recorder constructor/start attempt fails, it
tries `video/webm;codecs=vp8,opus`, then VP9/Opus, then generic WebM. Failed
MIME candidates are skipped for the rest of that recorder session. A generic
MP4 is checked for actual AVC; all WebM recordings are checked for VP8 or VP9
through Mediabunny before entering review.

Settings → Modules exposes the unchanged Konsta Range primitive with two
positions:
- `MP4 → WebM` (the default, automatic fallback);
- `WebM` (forced WebM-only for device-specific testing).

This temporary test preference is persisted only in the current device's local
storage. It is read at the beginning of every recording in both the Settings
probe and chat. No setting is sent to Dexie Cloud or other participants.

### WebM trim pipeline

The existing exact H.264/MP4 pipeline is preserved unchanged. WebM uses:

1. Mediabunny `WebM` input and `WebMOutputFormat`, attempting an exact selected
   time range with WebCodecs transcoding into the original WebM family.
2. If exact encoding fails, copy VP8/VP9 and Opus packets using `Conversion`
   forced-copy mode with `boundaryPolicy: 'shrink'` and relaxed timestamp shift,
   preserving synchronized streams and trimming only on keyframes.
3. On successful keyframe fallback, display the existing discussion-level Konsta
   Toast containing exactly “На вашем устройстве возможна обрезка только по
   ключевым кадрам”. Because the toast is owned by the discussion view it
   remains visible even after the recording editor closes.
4. If neither trim succeeds, keep the original WebM and show the established
   recoverable trim error. Do not include discarded video before the user's
   selected start boundary by silently expanding the trim region.

For an untrimmed recording, upload the original file without transcoding.
All WebM outputs use `video/webm` and the `.webm` extension. Existing direct
media upload, chat media metadata and round-video attachments accept WebM.

Telemetry includes `WEBM_AUTO_FALLBACK`, `WEBM_RUNTIME_FALLBACK`,
`WEBM_FORCED_MODE`, `RECORDER_MIME_ATTEMPT_FAILED`,
`WEBM_EXACT_TRIM_FAILED`, `WEBM_KEYFRAME_FALLBACK`, `WEBM_TRIM_FAILED` and
`WEBM_TRIM_INSPECTION_FAILED`. The diagnostic payload and Telegram richtext
remain privacy-filtered and limited in size. Detailed fallback fields are
prioritized before long browser capability lists.

CI on PR executes typecheck, tests and build. Runtime acceptance still requires
an Android Telegram WebView that reproduces the original failure, another
device for media playback compatibility, and a bot private chat that has
been started by the recipient.
