import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dexPath = process.argv[2];
if (!dexPath) {
  console.error('Usage: node tools/extract-gym-keeper-catalog.mjs <classes2.dex>');
  process.exit(2);
}

const bytes = readFileSync(dexPath);
const ascii = bytes.toString('latin1');
const matches = ascii.match(/https?:\/\/[^\s\x00"]+?\/img\/gifs\/180\/[^\s\x00"]+?\.gif/g) ?? [];
const urls = [...new Set(matches)];

const suffixPattern = /_(Waist|waist|Chest|chest|Hips|hips|Hip|Thighs|thighs|Upper-Arms|Upper-arms|Back|Shoulders|shoulder|Forearms|Forearm|Calves|Calf|Cardio|Plyometrics|Weightlifting|Weightlifts|Kettlebell)(?:-(FIX|AFIX|copy))?$/;

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

function mapEquipment(name) {
  const value = name.toLowerCase();
  if (value.startsWith('barbell ') || value.startsWith('ez barbell ')) return 'barbell';
  if (value.startsWith('dumbbell ')) {
    return ['one arm', 'one-arm', 'single arm', 'single-arm'].some((token) => value.includes(token))
      ? 'dumbbell_single'
      : 'dumbbell_pair';
  }
  if (value.startsWith('cable ')) return 'cable';
  if (['lever ', 'machine ', 'smith ', 'sled '].some((prefix) => value.startsWith(prefix))) return 'machine';
  if (
    value.startsWith('bodyweight ')
    || ['push up', 'push-up', 'pull up', 'pull-up', 'sit up', 'sit-up', 'crunch', 'plank'].some((token) => value.includes(token))
  ) return 'bodyweight';
  return 'other';
}

function parse(url, referenceOrder) {
  const fileName = decodeURIComponent(basename(new URL(url).pathname));
  let stem = fileName.replace(/\.gif$/i, '').replace(/_180$/i, '');
  stem = stem.replace(/^\d+-/, '');
  const suffixMatch = stem.match(suffixPattern);
  const suffix = suffixMatch?.[1] ?? '';
  if (suffixMatch) stem = stem.slice(0, suffixMatch.index);
  const name = stem.replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
  const categoryCode = mapCategory(suffix);
  const lowerName = name.toLowerCase();
  const trackingType = categoryCode === 'cardio'
    || ['run', 'running', 'walk', 'walking', 'jog', 'cycling', 'bicycle', 'elliptical', 'treadmill', 'swim', 'rowing machine']
      .some((token) => lowerName.includes(token))
    ? 'time_distance'
    : 'weight_reps';

  return {
    name,
    trackingType,
    categoryCode,
    equipmentCode: mapEquipment(name),
    referenceKey: fileName,
    referenceMediaUrl: url,
    referenceOrder,
  };
}

const rows = [];
const names = new Set();
for (const [index, url] of urls.entries()) {
  const row = parse(url, index + 1);
  const key = row.name.toLocaleLowerCase('en-US');
  if (names.has(key)) continue;
  names.add(key);
  rows.push(row);
}

console.error(`Found ${urls.length} unique APK GIF references; emitting ${rows.length} unique exercise names.`);
console.log('PRAGMA foreign_keys = ON;');
console.log('');
console.log('-- Generated from the supplied Gym Keeper APK classes2.dex.');
console.log('-- #34 owns copying the referenced media bytes into R2.');
console.log('INSERT OR IGNORE INTO exercise_definition (');
console.log('  scope, name, tracking_type, category_code, equipment_code, reference_source, reference_key, reference_order');
console.log(') VALUES');
console.log(rows.map((row) => `  ('global', ${sql(row.name)}, ${sql(row.trackingType)}, ${sql(row.categoryCode)}, ${sql(row.equipmentCode)}, 'gym_keeper_apk', ${sql(row.referenceKey)}, ${row.referenceOrder})`).join(',\n') + ';');
