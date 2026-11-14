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

Explicit H.264 MIME variants are attempted first. A bare `video/mp4` is used as
a fallback only when the embedded browser advertises it. Because container
support does not prove an AVC stream, Mediabunny inspects the recorded video track
before the existing H.264 trim editor can receive a generic MP4 recording.
Unsupported non-AVC recordings are rejected with the existing error UI; there
is no WebM-to-MP4 transcode or relaxation of editor requirements in this change.

CI on PR executes typecheck, tests and build. Runtime acceptance still requires
an Android Telegram WebView that reproduces the original failure and a bot
private chat that has been started by the recipient.
