# Gym Keeper → Mezfit UI icon mapping

Status: canonical mapping for the current Mezfit navigation shell.

Source APK: `com.kg.app.sportdiary_615_rs.apk`.

The product owner approved direct reuse of the reference APK UI icon assets. Mezfit imports the `xxxhdpi` monochrome variants because they remain crisp when rendered at 22–24 CSS px on high-density Telegram/Android displays. The browser renders them as CSS masks so active/inactive colors follow the current Mezfit global theme without modifying the source shapes.

| Mezfit semantic | Gym Keeper APK resource | Mezfit asset |
| --- | --- | --- |
| Clients / coach-client directory | `res/drawable-xxxhdpi-v4/ic_change_person.png` | `src/assets/gk-icons/ic_change_person.png` |
| Program / programs | `res/drawable-xxxhdpi-v4/ic_workout.png` | `src/assets/gk-icons/ic_workout.png` |
| Exercises | `res/drawable-xxxhdpi-v4/ic_exercise.png` | `src/assets/gk-icons/ic_exercise.png` |
| Calendar | `res/drawable-xxxhdpi-v4/ic_calendar.png` | `src/assets/gk-icons/ic_calendar.png` |
| Settings | `res/drawable-xxxhdpi-v4/ic_settings.png` | `src/assets/gk-icons/ic_settings.png` |
| About / information | `res/drawable-xxxhdpi-v4/ic_info.png` | `src/assets/gk-icons/ic_info.png` |
| Today | `res/drawable-xxxhdpi-v4/ic_today.png` | `src/assets/gk-icons/ic_today.png` |
| History | `res/drawable-xxxhdpi-v4/ic_history.png` | `src/assets/gk-icons/ic_history.png` |
| Progress / statistics | `res/drawable-xxxhdpi-v4/ic_stat.png` | `src/assets/gk-icons/ic_stat.png` |
| Back | `res/drawable-xxxhdpi-v4/ic_back.png` | `src/assets/gk-icons/ic_back.png` |

## Drawer menu icon

The reference APK does not contain a standalone `ic_menu`/hamburger bitmap. Its drawer stack includes Android/AppCompat/MaterialDrawer navigation infrastructure and the hamburger state is drawn programmatically by the action-bar drawer toggle rather than loaded from an app bitmap.

For Mezfit, `src/assets/gk-icons/menu.svg` reproduces that canonical 24 dp three-horizontal-line menu state. It is intentionally local and minimal; it is not an icon selected from a different visual library.

## Rendering rules

- drawer icon slot: 24 × 24 CSS px;
- app-bar icon visual: 22 × 22 CSS px inside a 44 × 44 touch target;
- source PNGs are not colorized files; alpha is consumed as a CSS mask and `currentColor` supplies theme color;
- active drawer item uses the global accent color;
- inactive items use the current surface text color;
- do not replace these mapped icons with emoji, Unicode glyphs, or an unrelated icon library without a linked product/design issue.
