import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dexPath = process.argv[2];
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.slice('--mode='.length) ?? 'seed';

if (!dexPath || !['seed', 'rename'].includes(mode)) {
  console.error('Usage: node tools/extract-gym-keeper-catalog.mjs <classes2.dex> [--mode=seed|rename]');
  process.exit(2);
}

const bytes = readFileSync(dexPath);

function readUInt32(offset) {
  return bytes.readUInt32LE(offset);
}

function readUleb128(offset) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (true) {
    const byte = bytes[cursor++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 28) throw new Error(`Invalid ULEB128 at ${offset}`);
  }
}

function readDexStrings() {
  if (bytes.subarray(0, 4).toString('ascii') !== 'dex\n') throw new Error('Input is not a DEX file');
  const stringIdsSize = readUInt32(56);
  const stringIdsOff = readUInt32(60);
  const strings = [];

  for (let index = 0; index < stringIdsSize; index += 1) {
    const dataOff = readUInt32(stringIdsOff + index * 4);
    const { next } = readUleb128(dataOff);
    const end = bytes.indexOf(0, next);
    if (end < 0) throw new Error(`Unterminated DEX string at index ${index}`);
    strings.push(bytes.subarray(next, end).toString('utf8'));
  }
  return strings;
}

function scanConstStrings(strings) {
  const refs = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 2) {
    if (bytes[offset] !== 0x1a) continue; // const-string vAA, string@BBBB
    const stringIndex = bytes.readUInt16LE(offset + 2);
    if (stringIndex >= strings.length) continue;
    refs.push({ offset, value: strings[stringIndex] });
  }
  return refs;
}

const cyrillic = /[А-Яа-яЁё]/;
const gifUrlPattern = /^https?:\/\/[^\s\x00"]+\/img\/gifs\/180\/[^\s\x00"]+\.gif$/i;
const suffixPattern = /_(Waist|waist|Chest|chest|Hips|hips|Hip|Thighs|thighs|Upper-Arms|Upper-arms|Back|Shoulders|shoulder|Forearms|Forearm|Calves|Calf|Cardio|Plyometrics|Weightlifting|Weightlifts|Kettlebell)(?:-(FIX|AFIX|copy))?_180$/;

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function mapCategory(suffix) {
  const value = suffix.toLowerCase();
  if (value === 'chest') return 'chest';
  if (['upper-arms', 'forearms', 'forearm'].includes(value)) return 'arms';
  if (value === 'back') return 'back';
  if (['hips', 'hip', 'thighs', 'calves', 'calf'].includes(value)) return 'legs';
  if (['shoulders', 'shoulder'].includes(value)) return 'shoulders';
  if (value === 'waist') return 'core';
  if (value === 'cardio') return 'cardio';
  return 'other';
}

function mapEquipment(englishName) {
  const value = englishName.toLowerCase();
  if (value.includes('· barbell') || value.includes('· ez barbell')) return 'barbell';
  if (value.includes('· dumbbell')) {
    return ['one arm', 'one-arm', 'single arm', 'single-arm'].some((token) => value.includes(token))
      ? 'dumbbell_single'
      : 'dumbbell_pair';
  }
  if (value.includes('· cable')) return 'cable';
  if (['· lever', '· machine', '· smith', '· sled'].some((token) => value.includes(token))) return 'machine';
  if (
    value.includes('bodyweight')
    || ['push up', 'push-up', 'pull up', 'pull-up', 'sit up', 'sit-up', 'crunch', 'plank'].some((token) => value.includes(token))
  ) return 'bodyweight';
  return 'other';
}

function suffixFromReferenceKey(referenceKey) {
  const stem = referenceKey.replace(/\.gif$/i, '').replace(/_180$/i, '');
  const match = stem.match(suffixPattern);
  return match?.[1] ?? '';
}

function extractRecords() {
  const strings = readDexStrings();
  const refs = scanConstStrings(strings);
  const allGifUrls = new Set(strings.filter((value) => gifUrlPattern.test(value)));
  const byUrl = new Map();

  for (let index = 0; index < refs.length; index += 1) {
    const current = refs[index];
    if (!gifUrlPattern.test(current.value) || byUrl.has(current.value)) continue;

    const previous = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = refs[cursor];
      if (current.offset - candidate.offset > 24) break;
      previous.push(candidate);
    }
    previous.reverse();

    const russian = [...previous].reverse().find((entry) => cyrillic.test(entry.value));
    if (!russian) continue;
    const english = previous.find((entry) => entry.offset > russian.offset && /[A-Za-z]/.test(entry.value) && !entry.value.startsWith('http'));
    if (!english) continue;

    const referenceKey = decodeURIComponent(basename(new URL(current.value).pathname));
    const suffix = suffixFromReferenceKey(referenceKey);
    const categoryCode = mapCategory(suffix);
    const lowerEnglish = english.value.toLowerCase();
    const trackingType = categoryCode === 'cardio'
      || ['run', 'running', 'walk', 'walking', 'jog', 'cycling', 'bicycle', 'elliptical', 'treadmill', 'swim', 'rowing machine']
        .some((token) => lowerEnglish.includes(token))
      ? 'time_distance'
      : 'weight_reps';

    byUrl.set(current.value, {
      name: russian.value,
      englishName: english.value,
      trackingType,
      categoryCode,
      equipmentCode: mapEquipment(english.value),
      referenceKey,
      referenceMediaUrl: current.value,
      bytecodeOffset: current.offset,
    });
  }

  if (byUrl.size !== allGifUrls.size) {
    const missing = [...allGifUrls].filter((url) => !byUrl.has(url));
    throw new Error(`Mapped ${byUrl.size}/${allGifUrls.size} APK GIF records. Missing: ${missing.join(', ')}`);
  }

  return [...byUrl.values()]
    .sort((a, b) => a.bytecodeOffset - b.bytecodeOffset)
    .map((row, index) => ({ ...row, referenceOrder: index + 1 }));
}

const rows = extractRecords();
console.error(`Extracted ${rows.length} Gym Keeper exercise records with exact Russian names.`);

console.log('PRAGMA foreign_keys = ON;');
console.log('');

if (mode === 'rename') {
  console.log('-- Exact Russian Gym Keeper names extracted from classes2.dex.');
  console.log('-- Stable reference_key keeps #34 media mapping unchanged.');
  for (const row of rows) {
    console.log(`UPDATE exercise_definition SET name = ${sql(row.name)} WHERE reference_source = 'gym_keeper_apk' AND reference_key = ${sql(row.referenceKey)};`);
  }
} else {
  console.log('-- Generated from the supplied Gym Keeper APK classes2.dex.');
  console.log('-- Russian names are copied from APK seed records; they are not translated from filenames.');
  console.log('-- #34 owns copying the referenced media bytes into R2.');
  console.log('INSERT OR IGNORE INTO exercise_definition (');
  console.log('  scope, name, tracking_type, category_code, equipment_code, reference_source, reference_key, reference_order');
  console.log(') VALUES');
  console.log(rows.map((row) => `  ('global', ${sql(row.name)}, ${sql(row.trackingType)}, ${sql(row.categoryCode)}, ${sql(row.equipmentCode)}, 'gym_keeper_apk', ${sql(row.referenceKey)}, ${row.referenceOrder})`).join(',\n') + ';');
}
