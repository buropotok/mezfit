import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dexPath = process.argv[2];
if (!dexPath) {
  console.error('Usage: node tools/extract-gym-keeper-catalog.mjs <classes2.dex>');
  process.exit(2);
}

const bytes = readFileSync(dexPath);

function u16(offset) {
  return bytes.readUInt16LE(offset);
}

function u32(offset) {
  return bytes.readUInt32LE(offset);
}

function readUleb128(offset) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (true) {
    const byte = bytes[cursor++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, cursor];
    shift += 7;
  }
}

function decodeStrings() {
  const stringIdsSize = u32(0x38);
  const stringIdsOff = u32(0x3c);
  const result = [];
  for (let index = 0; index < stringIdsSize; index += 1) {
    const stringDataOff = u32(stringIdsOff + index * 4);
    const [, start] = readUleb128(stringDataOff);
    let end = start;
    while (bytes[end] !== 0) end += 1;
    result.push(bytes.subarray(start, end).toString('utf8'));
  }
  return result;
}

const strings = decodeStrings();
const typeIdsOff = u32(0x44);
const methodIdsSize = u32(0x58);
const methodIdsOff = u32(0x5c);
const classDefsSize = u32(0x60);
const classDefsOff = u32(0x64);

function typeDescriptor(typeIndex) {
  return strings[u32(typeIdsOff + typeIndex * 4)];
}

function methodMeta(methodIndex) {
  const offset = methodIdsOff + methodIndex * 8;
  return {
    className: typeDescriptor(u16(offset)),
    name: strings[u32(offset + 4)],
  };
}

function collectMethodConstStrings() {
  const methods = new Map();
  for (let classIndex = 0; classIndex < classDefsSize; classIndex += 1) {
    const classDefOff = classDefsOff + classIndex * 32;
    const classDataOff = u32(classDefOff + 24);
    if (!classDataOff) continue;

    let cursor = classDataOff;
    const [staticFields, cursor1] = readUleb128(cursor); cursor = cursor1;
    const [instanceFields, cursor2] = readUleb128(cursor); cursor = cursor2;
    const [directMethods, cursor3] = readUleb128(cursor); cursor = cursor3;
    const [virtualMethods, cursor4] = readUleb128(cursor); cursor = cursor4;

    for (let i = 0; i < staticFields + instanceFields; i += 1) {
      [, cursor] = readUleb128(cursor);
      [, cursor] = readUleb128(cursor);
    }

    for (const methodCount of [directMethods, virtualMethods]) {
      let methodIndex = 0;
      for (let i = 0; i < methodCount; i += 1) {
        let diff;
        [diff, cursor] = readUleb128(cursor);
        methodIndex += diff;
        [, cursor] = readUleb128(cursor);
        let codeOff;
        [codeOff, cursor] = readUleb128(cursor);
        if (!codeOff) continue;

        const insnsSize = u32(codeOff + 12);
        const insnsOff = codeOff + 16;
        const constants = [];
        for (let unit = 0; unit < insnsSize; unit += 1) {
          const codeUnit = u16(insnsOff + unit * 2);
          const opcode = codeUnit & 0xff;
          if (opcode === 0x1a && unit + 1 < insnsSize) {
            const stringIndex = u16(insnsOff + (unit + 1) * 2);
            if (stringIndex < strings.length) constants.push({ unit, value: strings[stringIndex] });
            unit += 1;
          } else if (opcode === 0x1b && unit + 2 < insnsSize) {
            const stringIndex = u16(insnsOff + (unit + 1) * 2) | (u16(insnsOff + (unit + 2) * 2) << 16);
            if (stringIndex < strings.length) constants.push({ unit, value: strings[stringIndex] });
            unit += 2;
          }
        }
        methods.set(methodIndex, constants);
      }
    }
  }
  return methods;
}

const gifPattern = /^https?:\/\/[^\s\x00"]+?\/img\/gifs\/180\/[^\s\x00"]+?\.gif$/i;
const russianPattern = /[А-Яа-яЁё]/;
const methods = collectMethodConstStrings();

// Gym Keeper seeds its built-in exercise catalogue in one database initializer.
// We locate that initializer by behaviour (it references the complete GIF set and
// Russian catalogue labels) instead of relying on an obfuscated method index.
const candidates = [...methods.entries()].filter(([, constants]) => {
  const gifs = constants.filter(({ value }) => gifPattern.test(value)).length;
  const russian = constants.filter(({ value }) => russianPattern.test(value)).length;
  return gifs >= 300 && russian >= gifs;
});

if (candidates.length !== 1) {
  const labels = candidates.map(([index]) => {
    const meta = index < methodIdsSize ? methodMeta(index) : { className: '?', name: '?' };
    return `${index}:${meta.className}->${meta.name}`;
  });
  throw new Error(`Expected one Gym Keeper exercise seed method, found ${candidates.length}: ${labels.join(', ')}`);
}

const [seedMethodIndex, seedConstants] = candidates[0];
const seedMeta = methodMeta(seedMethodIndex);

const pairs = [];
let lastRussian = null;
for (const constant of seedConstants) {
  if (russianPattern.test(constant.value) && constant.value.length <= 120) lastRussian = constant;
  if (!gifPattern.test(constant.value)) continue;
  if (!lastRussian || constant.unit - lastRussian.unit > 12) {
    throw new Error(`Could not pair GIF with Russian exercise name near code unit ${constant.unit}`);
  }
  pairs.push({ name: lastRussian.value, url: constant.value });
}

if (pairs.length < 300) throw new Error(`Expected bundled Gym Keeper catalogue, found only ${pairs.length} exercise pairs`);

const suffixPattern = /_(Waist|waist|Chest|chest|Hips|hips|Hip|Thighs|thighs|Upper-Arms|Upper-arms|Back|Shoulders|shoulder|Forearms|Forearm|Calves|Calf|Cardio|Plyometrics|Weightlifting|Weightlifts|Kettlebell)(?:-(FIX|AFIX|copy))?$/;

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function mapCategoryFromRussianContext(name, suffix) {
  const value = suffix.toLowerCase();
  if (value === 'chest') return 'chest';
  if (['upper-arms', 'forearms', 'forearm'].includes(value)) return 'arms';
  if (value === 'back') return 'back';
  if (['hips', 'hip', 'thighs', 'calves', 'calf'].includes(value)) return 'legs';
  if (['shoulders', 'shoulder'].includes(value)) return 'shoulders';
  if (value === 'waist') return 'core';
  if (value === 'cardio') return 'cardio';
  if (/гиря|фермера|трастер|подъем на грудь|толчок|рывок|тяга сумо к подбородку|подъем силой/i.test(name)) return 'full_body';
  return 'other';
}

function mapEquipment(name) {
  const value = name.toLowerCase();
  if (value.includes('штанг')) return 'barbell';
  if (value.includes('гантель') && !value.includes('гантели')) return 'dumbbell_single';
  if (value.includes('гантели')) return 'dumbbell_pair';
  if (value.includes('блок') || value.includes('трос')) return 'cable';
  if (value.includes('тренажер') || value.includes('тренажёр')) return 'machine';
  if (value.includes('собственный вес') || value.includes('свой вес')) return 'bodyweight';
  return 'other';
}

function parse(pair, referenceOrder) {
  const fileName = decodeURIComponent(basename(new URL(pair.url).pathname));
  let stem = fileName.replace(/\.gif$/i, '').replace(/_180$/i, '').replace(/^\d+-/, '');
  const suffixMatch = stem.match(suffixPattern);
  const suffix = suffixMatch?.[1] ?? '';
  const categoryCode = mapCategoryFromRussianContext(pair.name, suffix);
  const trackingType = categoryCode === 'cardio' ? 'time_distance' : 'weight_reps';

  return {
    name: pair.name,
    trackingType,
    categoryCode,
    equipmentCode: mapEquipment(pair.name),
    referenceKey: fileName,
    referenceMediaUrl: pair.url,
    referenceOrder,
  };
}

const rows = pairs.map((pair, index) => parse(pair, index + 1));
const uniqueNames = new Set(rows.map((row) => row.name.toLocaleLowerCase('ru-RU')));
if (uniqueNames.size !== rows.length) throw new Error(`Duplicate Russian exercise names in APK seed: ${rows.length - uniqueNames.size}`);

console.error(`Located ${seedMeta.className}->${seedMeta.name}; emitting ${rows.length} exact Russian Gym Keeper exercise names.`);
console.log('PRAGMA foreign_keys = ON;');
console.log('');
console.log('-- Generated from the supplied Gym Keeper APK classes2.dex.');
console.log('-- Names are exact Russian strings from Gym Keeper, paired with their GIF references in the seed method.');
console.log('-- #34 owns copying the referenced media bytes into R2.');
console.log('INSERT OR IGNORE INTO exercise_definition (');
console.log('  scope, name, tracking_type, category_code, equipment_code, reference_source, reference_key, reference_order');
console.log(') VALUES');
console.log(rows.map((row) => `  ('global', ${sql(row.name)}, ${sql(row.trackingType)}, ${sql(row.categoryCode)}, ${sql(row.equipmentCode)}, 'gym_keeper_apk', ${sql(row.referenceKey)}, ${row.referenceOrder})`).join(',\n') + ';');
