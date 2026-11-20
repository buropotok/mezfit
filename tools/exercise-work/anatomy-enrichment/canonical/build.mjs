import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const input = path => resolve(ROOT, path);
const load = async path => JSON.parse(await readFile(input(path), 'utf8'));
const gitBlobSha = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const unique = items => [...new Set(items)];
const fail = reason => { throw new Error(reason); };

const ALIASES = Object.freeze({
  'head-harness': 'neck-harness',
  'v-grip-attachment': 'v-bar-attachment',
  'back-extension-bench': 'roman-chair',
  'dumbbells': 'dumbbell',
  'stationary bike': 'bike',
  'no equipment': 'none',
  'body only': 'none',
  'resistance band': 'band',
  'exercise band': 'band',
  'plate': 'weight plate',
  'plates': 'weight plate',
  'smith': 'smith machine',
  'body weight': 'bodyweight',
  'body-weight': 'bodyweight',
  'trapbar': 'trap bar',
  'trx suspension': 'trx',
});
const EQUIPMENT_CORRECTIONS = Object.freeze({
  'walk-wave-machine': ['walk-wave-machine'],
  'glute-ham-raise': ['nordic-curl-bench'],
  'korean-dips': ['dip bars'],
  'side-plank-oblique-crunch': ['bench'],
  'weighted-back-extension': ['roman-chair', 'weight plate'],
  'weighted-crunch': ['bench', 'weight plate'],
  'weighted-front-plank': ['weight plate'],
  'weighted-lying-twist': ['stability ball'],
  'weighted-one-arm-pull-up': ['pull-up bar', 'dumbbell'],
  'weighted-pull-up': ['pull-up bar', 'dip-belt', 'weight plate'],
  'weighted-side-bend-on-stability-ball': ['stability ball', 'weight plate'],
  'weighted-sit-ups': ['weight plate'],
});

export function normalizeEquipment(value) {
  if (typeof value !== 'string') fail('INVALID_EQUIPMENT');
  const lowered = value.trim().toLowerCase().replaceAll('_', '-');
  if (!lowered || lowered === 'full gym') return null;
  return ALIASES[lowered] ?? lowered;
}

export function canonicalEquipment(id, patch, source) {
  const slug = id.slice('fitnessprogramer:'.length);
  const values = EQUIPMENT_CORRECTIONS[slug] ?? patch.equipment ?? source.equipment;
  if (!Array.isArray(values)) fail('MISSING_EQUIPMENT: ' + id);
  let result = unique(values.map(normalizeEquipment).filter(Boolean));
  if (result.includes('other')) fail('UNRESOLVED_EQUIPMENT: ' + id);
  if (result.length > 1) result = result.filter(value => value !== 'none');
  if (!result.length) fail('EMPTY_EQUIPMENT: ' + id);
  return result;
}

export function selectRussianDescription(source) {
  const ru = (source.description_ru ?? source.how_to_ru ?? '').trim();
  const en = (source.description_en ?? source.how_to ?? '').trim();
  return { description: ru, description_ru: ru, description_en: en };
}

export function materializeExercise(record, source, manifest) {
  if (record.id !== manifest.id || !record.id.startsWith('fitnessprogramer:')) fail('INVALID_EXERCISE_ID');
  if (typeof source.name_ru !== 'string' || !source.name_ru.trim() || !source.source_url) fail('INVALID_SOURCE_CARD');
  const primaryCategory = record.patch.primary_category ?? manifest.primary_category;
  if (!primaryCategory) fail('MISSING_CATEGORY: ' + record.id);
  const localized = selectRussianDescription(source);
  const originalMuscles = record.patch.muscles ?? {};
  const unresolvedRoles = [];
  const canonicalMuscles = {};
  for (const role of ['primary', 'secondary', 'stabilizers']) {
    const roleValues = originalMuscles[role] ?? [];
    if (!Array.isArray(roleValues)) fail('INVALID_MUSCLE_ROLE: ' + record.id);
    if (roleValues.includes('other')) unresolvedRoles.push(role);
    canonicalMuscles[role] = unique(roleValues.filter(value => value !== 'other'));
  }
  return {
    id: record.id,
    name_ru: source.name_ru,
    name_en: source.name,
    ...localized,
    category: primaryCategory,
    categories: [primaryCategory],
    source_category_candidates: manifest.category_candidates,
    equipment: canonicalEquipment(record.id, record.patch, source),
    muscles: canonicalMuscles,
    tracking_type: source.tracking_type,
    image_id: source.image_id ?? null,
    gif_url: source.gif_url ?? '',
    source_url: source.source_url,
    source_path: record.source_path,
    source_blob_sha: record.source_blob_sha,
    original_card: source,
    quality: {
      agent_status: record.status,
      category_verified: record.category_verified,
      missing_russian_description: !localized.description_ru,
      unresolved_muscle_roles: unresolvedRoles,
    },
  };
}

async function main() {
  const [results, manifest] = await Promise.all([
    load('tools/exercise-work/anatomy-enrichment/consolidated/consolidated-index.json'),
    load('tools/exercise-work/anatomy-enrichment/batches.json'),
  ]);
  const entries = manifest.batches.flatMap(batch => batch.exercises);
  const manifestById = new Map(entries.map(item => [item.id, item]));
  if (results.records.length !== 1173 || manifestById.size !== 1173) fail('INCOMPLETE_BASE_2');
  const cards = [];
  for (const record of results.records) {
    const expected = manifestById.get(record.id);
    if (!expected || expected.source_path !== record.source_path
      || expected.source_blob_sha !== record.source_blob_sha) fail('INVALID_PROVENANCE: ' + record.id);
    const bytes = await readFile(input(record.source_path));
    if (gitBlobSha(bytes) !== record.source_blob_sha) fail('SOURCE_CHANGED: ' + record.id);
    cards.push(materializeExercise(record, JSON.parse(bytes.toString('utf8')), expected));
  }
  if (new Set(cards.map(card => card.id)).size !== 1173) fail('DUPLICATE_BASE_2_ID');
  cards.sort((a, b) => a.id.localeCompare(b.id));
  const report = {
    exercises: cards.length,
    missing_russian_descriptions: cards.filter(x => x.quality.missing_russian_description).length,
    unresolved_anatomy: cards.filter(x => x.quality.unresolved_muscle_roles.length).length,
    unverified_categories: cards.filter(x => !x.quality.category_verified).length,
  };
  const document = {
    schema_version: 1,
    status: 'candidate_not_published',
    source_commit: manifest.source_commit,
    base2_release: 'fitnessprogramer:v1',
    notes: 'Complete source cards with candidate enrichment; missing Russian instructions and anatomical uncertainties are explicit, not silently translated.',
    quality: report,
    exercises: cards,
  };
  const out = input('tools/exercise-work/anatomy-enrichment/canonical/fitnessprogramer-canonical.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(document, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ path: out, ...report }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
}
