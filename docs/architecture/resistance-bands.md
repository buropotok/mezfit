# Fitness bands — editable personal palette (stage 2)

## Scope

The normal Settings screen includes **Фитнес-ленты**. The five numbered
bands have stable identities 1–5; their colors are displayed as swatches and
can be edited without introducing or persisting a color-name field.

| Band | Default color | Default range (kg) |
| --- | --- | --- |
| 1 | Green, #49DF7B | 2–5 |
| 2 | Blue, #9FC5E8 | 6–9 |
| 3 | Yellow, #E7A91B | 10–13 |
| 4 | Red, #FF6B6B | 14–17 |
| 5 | Black, #252B33 | 18–21 |

The UI Kit RangePicker composes the existing, unchanged TwoColumnPicker with
TimePicker's compact wheel geometry and supports integral min/max 1–30 kg;
max is never less than min. The color editor composes the existing
GlassBackgroundColorControls wheel with its supported brightness setting.
No Konsta internals or primitive mechanics/styles are altered.

## Storage and safety

- The settings editor gets the authenticated `actorUserId` and Dexie database
  from the established `CloudConnectionsProvider`, **not** from an editable
  UI field, URL or `initDataUnsafe`.
- `FlexAttributesRepository` writes only changes relative to the built-in
  defaults in `user` personal realm; keys are `Band_1_color`,
  `Band_1_min`, `Band_1_max` through Band 5.
- Returning a previously overridden field to default writes `null`. There
  is no ordinary-user delete grant. A fresh account has no band rows until
  changing settings.
- The screen reads the local working copy immediately, then attempts a
  background initial pull; it merges remote values into fields the user has
  **not** touched and preserves the actively edited values. When saving, only
  explicitly edited `Band_{1..5}_{color|min|max}` keys are included in the EAV
  transaction; comparisons use the latest local synchronized records, not
  stale defaults on a second device. A concurrent min/max conflict is rejected
  rather than writing an invalid range or clobbering another field.
  A completed local save then waits for `Dexie Cloud Addon` push. Push failures
  are reported as *local save, cloud unconfirmed*, never as remote success.
- This PR is personal preferences only. Existing workout FACT `bands`
  values retain their current domain codes. Historical session snapshots and
  client/coach relationship sharing remain separate work; **no existing
  workout data or session semantics are rewritten here**.

## Test stand acceptance

After merge, CI and normal app deployment, use **Settings → Фитнес-ленты**
in the real Telegram Mini App:

1. Under an ordinary authenticated athlete account, change Band 2 from
   6–9 kg to 4–11 kg; change the color of Band 4. Tap
   **Сохранить ленты** and verify `Настройки отправлены в Dexie Cloud`.
2. Close the Mini App. Reopen Settings on the same device; both changes
   must persist. Repeat on an independent device with **the same Telegram
   account** to verify cross-device round-trip without a manual sample DB.
3. Tap **Вернуть исходные значения**, save, and confirm the original five
   ranges/colors on both devices. EAV rows may remain with `value: null`;
   that is the intended reset representation.
4. Disconnect networking and edit; local values remain usable and the UI
   must **not** falsely report successful cloud delivery. Restore the
   connection and retry Save.
5. Under a separate Telegram user, check that their personal palette is
   independent. A different account must not read the first user's values.
6. Two-device overlap test: on device B open the editor but do not edit Band 4.
   On device A change Band 4's color and sync. On device B change only Band 2's
   range and save, including while its initial pull is running. Confirm on
   device A that Band 4's color is not reset and Band 2 retains B's range.
   If two devices change incompatible ends of the *same* range, the save must
   refuse to create an invalid min/max pair rather than silently resetting
   the other endpoint.

These checks verify the actual settings product path, not a synthetic
diagnostic marker. Shared session ACL and immutable session snapshots still
require an explicit later implementation and ordinary-account verification.
