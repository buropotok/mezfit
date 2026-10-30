# Live Flex Attributes — opt-in ordinary-account smoke test

Status: diagnostic UI only. It is **not** a claim that the cloud installation,
Coach/Client relationship ACL, foreign-realm denial or cross-device persistence
has already been verified.

## Start

After merging the diagnostic PR, allow the standard application deployment to
finish. From the signed-in Telegram account, open:

https://t.me/mezfit_bot?startapp=cloud_auth_check

The existing **Проверка Dexie Cloud** page includes a new opt-in action
**Проверить Flex Attributes**. The diagnostic never runs automatically on app
startup, app settings, or other screens.

## Positive checks (same user, two independent devices)

1. Open the diagnostic inside Telegram. Ensure **Подтверждённый облачный
   пользователь: да**. Otherwise do not attempt writes.
2. Tap **Записать тестовое значение**. Wait until the screen states that the
   local write was checked and the Dexie Cloud Addon push completed.
   Record the displayed UTC marker (ISO date/time). A local success alone is
   not proof of persisted remote data.
3. Open the diagnostic in Telegram on another device/browser with **the same
   authenticated account**. Before writing anything there, tap
   **Загрузить из облака и прочитать**.
4. Verify the marker equals the one from step 2. Different markers or missing
   records mean the cross-device persistence check has not passed. Do not treat
   an apparently healthy general sync state as an alternative proof.
5. Optionally update the marker on device B and repeat a pull/read on device A
   to confirm that the fixed key was updated instead of duplicated.

The probe uses the ordinary `getMe` Worker identity and Dexie Cloud's current
authenticated user. It writes one append-once definition in the user's personal
realm (`MezfitFlexDiagnosticV1`) and upserts one string value in `flexValues`.
This technical record **remains** in that personal realm because generic Flex
role grants intentionally do not allow deleting remote records or attribute
definitions. No raw initData, credentials, IDs, remote error text, or cloud
configuration is displayed.

## What is *not* proven

This smoke test does not establish Coach/Client permissions for shared session
`flexValues`, nor server-side rejection of a malicious client writing forged
`entityType`, `entityId`, `attributeId`, `owner`, `realmId` or protected
PLAN/FACT data. A device-side repository's permission check alone is not
a security test of Dexie Cloud. Those tests require real, independent Coach A,
Client B and unrelated/revoked Client C identities, verified session realms
and carefully controlled server-denial scenarios. Do not attempt privileged
cross-realm writes or change live workout rows as part of this personal smoke
check.

If the smoke check fails, inspect the standard Dexie Cloud diagnostics and
sync state. Avoid posting Telegram initData, IDs, secrets, raw log bodies or
full private cloud records into a PR comment or support message.
