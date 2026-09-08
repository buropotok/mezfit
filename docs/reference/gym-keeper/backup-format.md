# Gym Keeper backup / export format

Status: reverse-engineering in progress.

This document separates **direct observations from the APK** from **inferences** and from **Mezfit compatibility decisions**.

## 1. Observed: there are at least two different data-transfer mechanisms

Gym Keeper exposes both a full backup/restore subsystem and a Program/Diary import-export subsystem. These should not be treated as one format until proven otherwise.

### 1.1 Full backup / restore

Observed strings and APIs in the APK include:

- `GymKeeper backup dated %s with %s workouts`
- `BACKUP COPY:`
- `BACKUP is OK!!!`
- `BACKUP INVALID - TRYING TO LOAD RESERVE BACKUP`
- `RESERVE BACKUP is OK`
- `RESERVE BACKUP INVALID, DELETING DATA`
- `gymkeeper_backup.`
- `gymkeeper_backup_reserve.`
- `backup_created`
- `backup_load`
- `backup_load_warning`
- `backup_share`
- `restore_local`
- `mi_restore_local`
- `autoBackup`
- `autoBackupGoogleDrive`
- `LAST_AUTO_BACKUP_DATE`
- `lastAutoBackupDate`
- Google Drive backup flow strings.

The APK also includes Realm APIs `writeCopy`, `nativeWriteCopy`, and `writeCopyTo()`.

### 1.2 Program / Diary import-export

Observed strings include:

- `export_diary`
- `export_program`
- `import_diary`
- `import_program`
- `importProgramOrDiary inputStream`
- `select_import`
- `import_action`
- `dialog_export_data`
- `export_format_data`
- `export_format_table`
- `export_format_text`
- `export_csv_guide`
- `export_guide`
- `Export`
- `import.`
- `.json`
- `json`
- `jsonArray`
- `jsonObject`
- `application/json`

There are also general JSON libraries present (Gson, kotlinx.serialization, org.json), so the presence of JSON libraries alone does not identify the exact serializer used by this subsystem.

## 2. Current inference

### 2.1 Full backup is likely database-oriented

The coexistence of:

- Realm database usage;
- `writeCopy` / `writeCopyTo()`;
- explicit backup validation / reserve-backup recovery;
- a backup filename prefix `gymkeeper_backup.`;

strongly suggests that the full backup path may contain a Realm database copy or another database-level snapshot rather than the same JSON payload used for Program/Diary sharing.

This is **not yet confirmed**. We need either method-level decompilation or a real backup sample.

### 2.2 Program / Diary transfer is likely logical JSON serialization

The explicit `export_program`, `export_diary`, `import_program`, `import_diary`, `importProgramOrDiary inputStream`, `.json`, and `application/json` strings strongly suggest a logical object exchange format that serializes a Program or Diary and related nested entities.

This is currently the leading candidate for migrating a coach's client diaries/programs into Mezfit if the trainer uses Gym Keeper's share/export feature per client.

## 3. Important distinction for Mezfit

Mezfit should implement import adapters, not adopt Gym Keeper's persistence format as its own domain protocol.

Target architecture:

```text
Gym Keeper file
    |
    v
GymKeeperImportAdapter
    |- detect format/version
    |- parse
    |- validate
    |- normalize IDs / units / dates
    |- resolve custom exercises
    |- map Diary / Program / Workout / Exercise / Set / Measures
    v
Mezfit canonical import model
    v
Mezfit domain + D1/R2
```

If full backup and Program/Diary export are separate formats, implement separate decoders behind the same detection layer.

## 4. Compatibility requirement

The migration use case requires preserving as much historical information as the source format contains, including where applicable:

- client/Diary name and identity marker;
- programs;
- workout/day structure;
- exercise order;
- exercises and custom exercises;
- muscle group / tracking type;
- planned/result sets;
- weight, reps, duration, distance;
- difficulty / effort flags;
- supersets;
- exercise/day comments;
- workout dates and completion history;
- measurements and measurement records;
- photos/media references when transferable;
- unit semantics.

Imported historical data must remain immutable after conversion to Mezfit's canonical domain.

## 5. What is still unknown

We still need to determine:

1. exact filename extensions for `gymkeeper_backup.*`, `import.*`, and Program/Diary exports;
2. whether the full backup is raw Realm, Realm `writeCopy`, compressed Realm, ZIP/GZIP, or a custom envelope;
3. whether Program/Diary export is plain JSON, compressed JSON, or a wrapper around JSON;
4. root JSON keys and schema version markers;
5. ID strategy and referential links;
6. whether a Diary export contains one client only or multiple diaries;
7. whether image/GIF/photo assets are embedded, referenced by URI, or omitted;
8. whether custom exercise definitions are duplicated into the export;
9. whether settings/units are exported alongside data;
10. whether import supports older schema versions and migration logic.

## 6. Next evidence needed

Best evidence is a real file produced by Gym Keeper:

- one full local backup;
- one exported Diary;
- one exported Program.

A minimal synthetic test dataset is ideal: one custom exercise, one normal exercise, one superset, one workout with several set types, one comment, one body measurement, and one photo. This makes field mapping unambiguous.

Until a real sample is available, reverse engineering should continue at method/class level in `com.kg.app.sportdiary.db.backup.*` and the import/export call sites.
