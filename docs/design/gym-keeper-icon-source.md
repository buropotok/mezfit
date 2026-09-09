# Gym Keeper navigation icon provenance

Source APK: `com.kg.app.sportdiary_615_rs.apk`.

Issue #52 uses the original 24×24 monochrome PNGs from `res/drawable-mdpi-v4`. The byte content is embedded as base64 data URIs in `src/gymKeeperIcons.ts`; CSS consumes each PNG as an alpha mask so the artwork can inherit Mezfit theme colors without modifying its geometry.

Selected resources: `ic_change_person`, `ic_workout`, `ic_exercise`, `ic_calendar`, `ic_today`, `ic_history`, `ic_stat`, `ic_settings`, `ic_info`, `ic_back`, and `ic_more`.

The semantic mapping is canonicalized in `docs/design/navigation-shell.md`.
