import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dexPath = process.argv[2];
if (!dexPath) {
  console.error('Usage: node tools/extract-gym-keeper-catalog.mjs <classes2.dex>');
  process.exit(2);
}

const bytes = readFileSync(dexPath);

function readUleb128(buffer, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
    if (shift > 28) throw new Error(`Invalid ULEB128 at 0x${start.toString(16)}`);
  }
  throw new Error(`Truncated ULEB128 at 0x${start.toString(16)}`);
}

function readDexStrings(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') !== 'dex\n') {
    throw new Error('Expected a DEX file');
  }
  const stringCount = buffer.readUInt32LE(0x38);
  const stringIdsOffset = buffer.readUInt32LE(0x3c);
  const strings = [];
  for (let index = 0; index < stringCount; index += 1) {
    const dataOffset = buffer.readUInt32LE(stringIdsOffset + index * 4);
    const { offset: contentOffset } = readUleb128(buffer, dataOffset);
    const end = buffer.indexOf(0, contentOffset);
    if (end < 0) throw new Error(`Unterminated DEX string #${index}`);
    strings.push(buffer.subarray(contentOffset, end).toString('utf8'));
  }
  return strings;
}

function readConstStrings(buffer, strings) {
  const result = [];
  // const-string is a 2-code-unit DEX instruction: 0x1a, destination register,
  // then a uint16 string index. Candidate catalogue records are validated by
  // their exact GIF string value and the adjacent Russian display-name load.
  for (let offset = 0; offset + 4 <= buffer.length; offset += 2) {
    if (buffer[offset] !== 0x1a) continue;
    const stringIndex = buffer.readUInt16LE(offset + 2);
    if (stringIndex >= strings.length) continue;
    result.push({ offset, stringIndex, value: strings[stringIndex] });
  }
  return result;
}

const strings = readDexStrings(bytes);
const constStrings = readConstStrings(bytes, strings);
const isExerciseGif = (value) => /\/img\/gifs\/180\/[^/]+\.gif$/i.test(value);
const hasCyrillic = (value) => /[А-Яа-яЁё]/.test(value);
const gifUrls = strings.filter(isExerciseGif);
const russianNameByUrl = new Map();

for (let index = 0; index < constStrings.length; index += 1) {
  const current = constStrings[index];
  if (!isExerciseGif(current.value)) continue;

  let russianName = null;
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previous = constStrings[previousIndex];
    if (current.offset - previous.offset > 24) break;
    if (hasCyrillic(previous.value)) {
      russianName = previous.value;
      break;
    }
  }
  if (!russianName) continue; // Ignore false-positive byte patterns outside executable catalogue code.

  const existing = russianNameByUrl.get(current.value);
  if (existing && existing !== russianName) {
    throw new Error(`Conflicting Russian names for ${current.value}: ${existing} / ${russianName}`);
  }
  russianNameByUrl.set(current.value, russianName);
}

const uniqueUrls = [...new Set(gifUrls)];
const missingRussianNames = uniqueUrls.filter((url) => !russianNameByUrl.has(url));
if (missingRussianNames.length) {
  throw new Error(`Could not recover Russian Gym Keeper names for ${missingRussianNames.length} GIF(s):\n${missingRussianNames.join('\n')}`);
}

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

function mapEquipment(sourceName) {
  const value = sourceName.toLowerCase();
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
  const sourceName = stem.replaceAll('-', ' ').replace(/\s+/g, ' ').trim();
  const categoryCode = mapCategory(suffix);
  const lowerName = sourceName.toLowerCase();
  const trackingType = categoryCode === 'cardio'
    || ['run', 'running', 'walk', 'walking', 'jog', 'cycling', 'bicycle', 'elliptical', 'treadmill', 'swim', 'rowing machine']
      .some((token) => lowerName.includes(token))
    ? 'time_distance'
    : 'weight_reps';

  return {
    name: russianNameByUrl.get(url),
    sourceName,
    trackingType,
    categoryCode,
    equipmentCode: mapEquipment(sourceName),
    referenceKey: fileName,
    referenceMediaUrl: url,
    referenceOrder,
  };
}

const rows = uniqueUrls.map((url, index) => parse(url, index + 1));
const duplicateNames = rows.reduce((map, row) => {
  const key = row.name.toLocaleLowerCase('ru-RU');
  map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}, new Map());
const collisions = [...duplicateNames.entries()].filter(([, count]) => count > 1);
if (collisions.length) {
  throw new Error(`APK Russian catalogue contains duplicate global names: ${collisions.map(([name]) => name).join(', ')}`);
}

console.error(`Found ${uniqueUrls.length} unique APK GIF references with ${rows.length} exact Russian Gym Keeper names.`);
console.log('PRAGMA foreign_keys = ON;');
console.log('');
console.log('-- Generated from the supplied Gym Keeper APK classes2.dex.');
console.log('-- Russian names are recovered from the same static catalogue records as the GIF references.');
console.log('-- #34 owns copying the referenced media bytes into R2.');
console.log('INSERT OR IGNORE INTO exercise_definition (');
console.log('  scope, name, tracking_type, category_code, equipment_code, reference_source, reference_key, reference_order');
console.log(') VALUES');
console.log(rows.map((row) => `  ('global', ${sql(row.name)}, ${sql(row.trackingType)}, ${sql(row.categoryCode)}, ${sql(row.equipmentCode)}, 'gym_keeper_apk', ${sql(row.referenceKey)}, ${row.referenceOrder})`).join(',\n') + ';');
