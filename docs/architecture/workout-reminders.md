# Telegram workout reminders — MVP

Status: implementation proposal, subject to PR review, CI and production secret provisioning.

## Product rules

Only people who physically participate in a scheduled workout receive an advance reminder:

- Athlete in a Coach/Client relationship: always eligible for their workout, whether `independent` or `coached`. Their personal `notify_client_workouts` flag controls delivery.
- Coach participating in a `coached` client workout: eligible, independently of the athlete's setting. Their `notify_coach_client_workouts` flag controls delivery.
- Coach doing a personal `independent` workout as an athlete: eligible. Their `notify_coach_own_workouts` flag controls delivery.
- Independent workouts of clients do **not** notify their coaches.
- User accounts holding both Coach and Client roles simultaneously are outside MVP scope. A personal occurrence with ambiguous role registration is ignored, not guessed.

The three personal boolean preferences live in the existing authenticated actor's personal realm, in `flexAttributes`/`flexValues`. Missing/null means enabled; malformed values fail closed. Ordinary app writes are local-first through `FlexAttributesRepository` + Dexie Cloud Addon; no Worker preference endpoint or business CRUD is introduced.

## Delivery

Cloudflare Cron runs every five minutes, reads only published scheduled occurrences from the canonical Dexie Cloud API, and checks which ones cross the T−60 minute threshold within the last ten minutes. Eligibility is evaluated at the actual Worker execution time, not the nominal Cron trigger time. It excludes inactive, cancelled, started/completed and personal-event entries. A booking must be synced to Dexie Cloud before it can be considered. Late-synced, last-minute or offline-only bookings outside the grace window do not generate retroactive notifications.

Shared relationship occurrences require the existing deterministic realm and exactly two accepted, server-provisioned members, using the same pure relationship validation as the client projections. Failed lookups or sends for one recipient do not prevent attempting other recipients; the tick reports a sanitized aggregate partial-failure status. Personal occurrences use the athlete's private realm and the single registered Coach/Client role from existing `/api/me` D1 user-role data. Cloud occurrence identity and publication state are re-read immediately before delivery.

Each recipient preference is independently read from its personal `flexValues` record. Switching a toggle affects future cloud-visible decisions, without waiting for a Worker command. Telegram sends via Bot API to the user's own private chat. A user must first press Start in `@mezfit_bot`; the bot cannot initiate a chat uninvited. Coach reminders use a Rich Message in the client topic (or «Общее» for a personal workout), with an embedded button opening the scheduled occurrence. Client reminders retain their existing delivery. See [Telegram coach notifications](#telegram-coach-notifications).

### Delivery journal

D1 table `workout_reminder_delivery` holds **only** occurrence ID, recipient ID, start timestamp, reminder kind, status, attempt counts and Telegram delivery metadata. No workout PLAN, FACT, calendar read model, user preference or shadow sync is stored in D1. The key is deterministic over occurrence + UTC start + recipient + reminder category. An atomic conditional update claims an attempt before contacting Telegram. Subsequent Cron ticks cannot send a successfully claimed/sent reminder again, but a crash after claim can lose that attempt. Transient Telegram failures can be retried up to three attempts, only within the T−60 + 10 minute grace window. Exactly-once delivery is not promised. A reschedule with a different start instant may create a new reminder.

## Operations and rollout

1. Create a **new dedicated service account with read-only scopes**, never the existing membership administrator, protected publisher or client impersonation credentials. An authorized operator can use the official Dexie Cloud CLI, e.g. `npx dexie-cloud authorize <service-email> --service-account --scopes ACCESS_DB,GLOBAL_READ --out reminders-service.key`. Never commit or share the resulting key file.
2. Configure Cloudflare Worker secrets `DEXIE_CLOUD_REMINDER_CLIENT_ID` and `DEXIE_CLOUD_REMINDER_CLIENT_SECRET` from that account. Restrict their access to the Worker; do not expose them through `/api` or the browser.
3. Apply D1 migration `0030_workout_reminder_delivery.sql` before publishing the Cron Worker. The existing `npm run deploy` workflow applies remote D1 migrations before Worker deployment. Cron configuration is `*/5 * * * *` (UTC).
4. Verify the bot token, actual private-chat activation, one athlete self-workout, one independent assigned workout and one coached workout, for each on/off state; separately exercise schedule change, cancellation, unstarted bot and repeated Cron ticks.
5. If the service credentials are missing or the cloud is unavailable, delivery fails closed. Do not pretend the toggles were synchronized or Telegram messages were delivered. Avoid logging credentials, token URLs, message contents or personal records.

This MVP is intentionally small: no chat replies, webhook-based bot activation state, configurable offsets, delivery receipts UI or guarantee of catch-up after prolonged outages. The settings surface links to the bot's Start chat but cannot prove whether that action was completed.

**Capacity and retention limitations:** this pre-MVP implementation scans the current published scheduled occurrence set and fails closed when it exceeds 25,000 rows. Each due relationship and recipient requires additional authorized REST reads; a future scale-out must respect Dexie Cloud API rate limits without creating a shadow business database. The technical D1 delivery journal does not yet enforce an automatic data-retention period; that and high-volume delivery scheduling need a focused follow-up before broad production rollout.


## Telegram coach notifications

The production switch is the Worker secret `DEXIE_DISCUSSION_WEBHOOK_SECRET`. With the secret absent, workout reminders use the previous Bot API message. Before setting it, enable private-chat topics for the bot and verify `getMe.has_topics_enabled`. Apply D1 migration `0031_telegram_coach_notifications.sql` through the normal deploy workflow.

In Dexie Cloud Manager, add a webhook pointing to `/api/webhooks/dexie-discussions` on the Worker host with the same secret. Select the `discussionMessages` table and the upsert/update operations. Publication of a saved draft can arrive as a realm update; ordinary text edits are ignored. Avoid logging webhook bodies, which can contain message text.

The Worker accepts webhook batches into D1 and dispatches them from the existing five-minute Cron, with up to twelve attempts per event. It checks cloud publication, membership, attachment readiness and the coach's personal preferences before delivery. The D1 tables contain delivery metadata and Telegram topic routing only. For topic recreation and sends, an interrupted Telegram request can leave an ambiguous outcome. Telegram offers no exactly-once guarantee for these operations.

Before rollout, validate a fresh private bot chat, multiple clients (including duplicate display names), a renamed client, a personal workout, and deep links on Android/iOS. Test a text message, a finished media upload and an offline send that syncs later.
