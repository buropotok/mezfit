#!/usr/bin/env node
// Read-only FitnessProgramer diagnostic. Never edits source exercises or cloud data.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_MANIFEST = 'tools/exercise-work/anatomy-enrichment/batches.json';
const at = flag => process.argv.indexOf(flag);
const manifestPath = at('--manifest') < 0 ? DEFAULT_MANIFEST : process.argv[at('--manifest') + 1];
const outputPath = at('--output') < 0 ? null : process.argv[at('--output') + 1];
const fail = message => { throw new Error(message); };
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const slugOf = path => path.split('/').at(-1).replace(/\.json$/, '');
const gitSha = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const lower = value => String(value).trim().toLowerCase();
const unique = values => [...new Set(values)];

function readLiteralMap(source, declaration, minimum) {
  const start = source.indexOf(declaration);
  if (start < 0) fail('MISSING_VOCABULARY: ' + declaration);
  const brace = source.indexOf('{', source.indexOf('=', start));
  const end = source.indexOf('};', brace);
  if (brace < 0 || end < 0) fail('UNRECOGNIZED_VOCABULARY: ' + declaration);
  const map = {};
  const re = /(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*'([^']+)'/g;
  for (const match of source.slice(brace + 1, end).matchAll(re))
    map[match[1] ?? match[2]] = match[3];
  if (Object.keys(map).length < minimum) fail('INCOMPLETE_VOCABULARY: ' + declaration);
  return map;
}
function validateManifest(manifest) {
  if (manifest.schema_version !== 1 || manifest.unique_exercises !== 1173
    || manifest.source_json_files !== 1673 || manifest.batch_size !== 100
    || manifest.batches?.length !== 12) fail('INVALID_MANIFEST');
  const ids = new Set(), paths = new Set();
  for (let i = 0; i < manifest.batches.length; i++) {
    const batch = manifest.batches[i];
    if (batch.id !== 'B' + String(i + 1).padStart(3, '0')
      || !Array.isArray(batch.exercises) || !batch.exercises.length
      || batch.exercises.length > 100) fail('INVALID_BATCH: ' + batch.id);
    for (const row of batch.exercises) {
      if (ids.has(row.id) || row.id !== 'fitnessprogramer:' + slugOf(row.source_path)
        || !/^[0-9a-f]{40}$/.test(row.source_blob_sha)) fail('INVALID_EXERCISE: ' + row.id);
      ids.add(row.id);
      if (!Array.isArray(row.category_candidates) || !Array.isArray(row.duplicate_paths)
        || !row.category_candidates.includes(row.primary_category)
        || row.category_review_required !== (row.category_candidates.length > 1))
        fail('INVALID_CATEGORY: ' + row.id);
      for (const path of [row.source_path, ...row.duplicate_paths]) {
        if (!/^assets\/work\/[^/]+\/[^/]+\.json$/.test(path)
          || paths.has(path) || slugOf(path) !== slugOf(row.source_path))
          fail('INVALID_SOURCE_PATH: ' + path);
        paths.add(path);
      }
    }
  }
  if (ids.size !== 1173 || paths.size !== 1673) fail('INCOMPLETE_MANIFEST');
}
async function run() {
  if (!manifestPath || (at('--output') >= 0 && !outputPath)) fail('INVALID_COMMAND_LINE');
  const manifestFile = resolve(ROOT, manifestPath);
  const outputFile = outputPath ? resolve(ROOT, outputPath) : null;
  if (outputFile && (outputFile === manifestFile
    || outputFile.startsWith(resolve(ROOT, 'assets/work') + '/')))
    fail('OUTPUT_CANNOT_OVERWRITE_SOURCE');
  const [manifest, taxonomy, equipmentSource, catalogueSource] = await Promise.all([
    readJson(manifestFile),
    readJson(resolve(ROOT, 'audit/visual/input/taxonomy.json')),
    readFile(resolve(ROOT, 'src/data/exercises/publicExerciseFilters.ts'), 'utf8'),
    readFile(resolve(ROOT, 'src/data/exercises/fitnessProgramerCatalogue.ts'), 'utf8'),
  ]);
  validateManifest(manifest);
  if (!taxonomy.taxonomy || Object.keys(taxonomy.taxonomy).length !== 69)
    fail('INVALID_BASE1_TAXONOMY');
  const equipmentLabels = readLiteralMap(equipmentSource, 'export const EQUIPMENT_LABELS', 30);
  const muscleAliases = readLiteralMap(catalogueSource, 'const muscleAliases', 10);
  const equipmentAliases = readLiteralMap(catalogueSource, 'const equipmentAliases', 1);
  if (equipmentLabels['smith machine'] !== 'Тренажёр Смита')
    fail('SMITH_MACHINE_LABEL_CONTRACT_CHANGED');
  const muscleId = raw => muscleAliases[lower(raw)]
    ?? lower(raw).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const metrics = {
    unique_exercises: 0, verified_source_files: 0, anatomy_completely_empty: 0,
    primary_muscles_empty: 0, exercises_with_unmapped_muscles: 0, unmapped_muscle_terms: 0,
    equipment_empty: 0, generic_machine: 0,
    exercises_with_unknown_equipment: 0, unknown_equipment_terms: 0,
    cross_category_review_required: 0, exercises_requiring_attention: 0,
    exercises_without_detected_vocabulary_problems: 0,
  };
  const findings = [];
  for (const batch of manifest.batches) for (const row of batch.exercises) {
    const bytes = await readFile(resolve(ROOT, row.source_path));
    if (gitSha(bytes) !== row.source_blob_sha) fail('SOURCE_CHANGED: ' + row.source_path);
    metrics.verified_source_files++;
    const card = JSON.parse(bytes.toString('utf8'));
    if (card.source_url !== 'https://fitnessprogramer.com/exercise/'
      + row.id.slice('fitnessprogramer:'.length) + '/'
      || !Array.isArray(card.equipment) || !Array.isArray(card.muscles?.target))
      fail('INVALID_SOURCE_EXERCISE: ' + row.id);
    for (const path of row.duplicate_paths) {
      if (gitSha(await readFile(resolve(ROOT, path))) !== row.source_blob_sha)
        fail('SOURCE_DUPLICATE_CHANGED: ' + path);
      metrics.verified_source_files++;
    }
    const roles = {
      primary: card.muscles.target,
      secondary: card.muscles.synergists ?? [],
      stabilizers: card.muscles.stabilizers?.dynamic ?? [],
    };
    if (Object.values(roles).some(values => !Array.isArray(values)))
      fail('INVALID_ANATOMY_ARRAYS: ' + row.id);
    const anatomyEmpty = Object.values(roles).every(values => values.length === 0);
    const primaryEmpty = roles.primary.length === 0;
    const unknownMuscles = unique(Object.values(roles).flat()
      .filter(raw => !Object.hasOwn(taxonomy.taxonomy, muscleId(raw))));
    const equipment = card.equipment.map(lower).filter(raw => raw !== 'full gym');
    const unknownEquipment = unique(equipment
      .filter(raw => !Object.hasOwn(equipmentLabels, equipmentAliases[raw] ?? raw)));
    const genericMachine = equipment.some(raw => raw === 'machine' || raw === 'machines');
    const equipmentEmpty = equipment.length === 0;
    const attention = anatomyEmpty || primaryEmpty || unknownMuscles.length > 0
      || unknownEquipment.length > 0 || genericMachine || equipmentEmpty
      || row.category_review_required;
    metrics.unique_exercises++;
    metrics.anatomy_completely_empty += Number(anatomyEmpty);
    metrics.primary_muscles_empty += Number(primaryEmpty);
    metrics.exercises_with_unmapped_muscles += Number(unknownMuscles.length > 0);
    metrics.unmapped_muscle_terms += unknownMuscles.length;
    metrics.equipment_empty += Number(equipmentEmpty);
    metrics.generic_machine += Number(genericMachine);
    metrics.exercises_with_unknown_equipment += Number(unknownEquipment.length > 0);
    metrics.unknown_equipment_terms += unknownEquipment.length;
    metrics.cross_category_review_required += Number(row.category_review_required);
    metrics.exercises_requiring_attention += Number(attention);
    metrics.exercises_without_detected_vocabulary_problems += Number(!attention);
    findings.push({
      id: row.id, batch: batch.id, source_path: row.source_path,
      primary_category: row.primary_category, category_review_required: row.category_review_required,
      anatomy_empty: anatomyEmpty, primary_muscles_empty: primaryEmpty,
      unknown_muscles: unknownMuscles, equipment_empty: equipmentEmpty,
      generic_machine: genericMachine, unknown_equipment: unknownEquipment,
      needs_attention: attention,
    });
  }
  if (metrics.unique_exercises !== 1173 || metrics.verified_source_files !== 1673
    || metrics.cross_category_review_required !== manifest.category_review_required)
    fail('DIAGNOSTIC_COVERAGE_FAILED');
  const report = {
    schema_version: 1, source_commit: manifest.source_commit, source_unchanged: true,
    note: 'Heuristic diagnostics, not verified biomechanical classification. Cross-category choices are provisional.',
    metrics, findings,
  };
  if (outputFile) await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ source_commit: manifest.source_commit,
    metrics, report_path: outputFile }, null, 2) + '\n');
}
run().catch(error => {
  process.stderr.write('Enrichment diagnostics failed: ' + String(error) + '\n');
  process.exitCode = 1;
});
