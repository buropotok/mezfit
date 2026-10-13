#!/usr/bin/env node
/**
 * Operator-only: prepare immutable, additive public-realm imports from a
 * downloaded R2 source; never connects to Dexie Cloud or carries credentials.
 * CLI publishing is deliberately split into records and activation steps.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const EXPECTED_SOURCE_SHA256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const SOURCE_CATALOGUE = 'mezfit.exercise_catalog.ru_anatomy';
const MANIFEST_ID = 'mezfit:exercise-catalogue';

function fail(message) { throw new Error(message); }
function string(value) { return typeof value === 'string' && value.length > 0; }
function arrayStrings(value) { return Array.isArray(value) && value.every(string); }

export function validateCatalogue(data) {
  if (!data || data.schema_version !== '2.0.0' || data.catalogue !== SOURCE_CATALOGUE)
    fail('Unexpected catalogue or schema_version');
  if (!data.metadata || data.metadata.exercise_count !== 1324
      || data.metadata.source_id_preserved !== true) fail('Unexpected source metadata');
  const exercises = data.exercises;
  const taxonomy = data.taxonomy;
  const labels = data.subcategory_labels_ru;
  if (!Array.isArray(exercises) || exercises.length !== 1324) fail('Expected exactly 1324 exercises');
  if (!taxonomy || typeof taxonomy !== 'object' || Array.isArray(taxonomy)
      || Object.keys(taxonomy).length !== 69) fail('Expected 69 taxonomy nodes');
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) fail('Invalid labels');
  if (!data.movement_family_references || typeof data.movement_family_references !== 'object')
    fail('Missing movement family references');
  const validCategories = new Set(['chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio', 'other']);
  const used = new Set();
  const sourceIssues = [];
  for (const [id, node] of Object.entries(taxonomy)) {
    if (!string(id) || !node || !string(node.category_ru)
        || !string(node.subcategory_ru) || !string(node.anatomical_description_ru)
        || !['muscle', 'group', 'head', 'part', 'zone', 'function'].includes(node.kind)
        || (node.parent_id !== null && !(node.parent_id in taxonomy))) fail(`Invalid taxonomy ${id}`);
  }
  for (const row of exercises) {
    if (!row || typeof row !== 'object' || !/^\d{4}$/.test(row.id) || used.has(row.id))
      fail(`Invalid / duplicate exercise ID ${row?.id}`);
    used.add(row.id);
    if (!string(row.name) || !string(row.name_ru) || !string(row.name_en)
        || !validCategories.has(row.category)
        || !string(row.subcategory) || !string(labels[row.subcategory])
        || row.subcategory_ru !== labels[row.subcategory]
        || !string(row.movement_type) || !string(row.equipment)
        || !row.muscles || !['primary', 'secondary', 'stabilizers', 'emphasis'].every((k) => arrayStrings(row.muscles[k]))
        || !arrayStrings(row.mobility_targets) || !arrayStrings(row.secondary_muscles)
        || !string(row.media_id) || !string(row.image) || !string(row.gif_url)
        || !string(row.attribution) || !string(row.created_at)
        || !row.instructions || !string(row.instructions.ru) || !string(row.instructions.en)
        || !row.instruction_steps || !arrayStrings(row.instruction_steps.ru)
        || !arrayStrings(row.instruction_steps.en)
        || !row.anatomy_evidence || !string(row.anatomy_evidence.classification_family)
        || !string(row.anatomy_evidence.basis)
        || typeof row.anatomy_evidence.external_individual_match !== 'boolean')
      fail(`Invalid exercise ${row.id}`);
    for (const anatomyId of [
      ...row.muscles.primary, ...row.muscles.secondary, ...row.muscles.stabilizers,
      ...row.muscles.emphasis, ...row.mobility_targets,
    ]) if (!(anatomyId in taxonomy)) fail(`Unknown taxonomy ${anatomyId} at ${row.id}`);
    if (row.image !== `images/${row.id}-${row.media_id}.jpg`
      || row.gif_url !== `videos/${row.id}-${row.media_id}.gif`)
      fail(`Unexpected media reference ${row.id}`);
    if (row.source_consistency_issue !== null) sourceIssues.push(row.id);
  }
  if (sourceIssues.length !== 9 || data.metadata.source_consistency_issues_count !== 9)
    fail('Source consistency issues changed unexpectedly');
  return { exercises, taxonomy, labels, sourceIssues };
}

function getPublicTable(exportData, name) {
  if (!exportData || typeof exportData !== 'object') fail('Invalid exported cloud data');
  return exportData.data?.['rlm-public']?.[name] ?? {};
}

function normalizeExportedRow(key, value) {
  return value && typeof value === 'object' ? { ...value, id: value.id ?? key } : null;
}

export function diffExerciseRecords(existing, nextRecords) {
  const added = [], changed = [], unchanged = [], missing = [];
  for (const [id, row] of Object.entries(nextRecords)) {
    if (!(id in existing)) { added.push(id); continue; }
    const earlier = normalizeExportedRow(id, existing[id]);
    if (earlier && Object.entries(row).every(([key, value]) =>
      isDeepStrictEqual(earlier[key], value))) unchanged.push(id);
    else changed.push(id);
  }
  for (const id of Object.keys(existing)) if (!(id in nextRecords)) missing.push(id);
  return { added, changed, unchanged, missing };
}

async function parseArgs() {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--assume-empty') { opt.assumeEmpty = true; continue; }
    if (!['--source', '--previous', '--out-dir', '--verify-export'].includes(args[i])) fail(`Unknown option ${args[i]}`);
    const value = args[++i];
    if (!value) fail(`Missing value for ${args[i - 1]}`);
    opt[args[i - 1].slice(2)] = value;
  }
  if (!opt.source) fail('Specify --source, a verified file obtained from R2');
  return opt;
}

export async function prepare(source, previous, publishedAt) {
  const { exercises, taxonomy, labels, sourceIssues } = validateCatalogue(source);
  const sourceSha256 = EXPECTED_SOURCE_SHA256;
  if (!previous.data || !previous.data['rlm-public']) fail('Expected complete previous public realm export');
  const previousManifest = getPublicTable(previous, 'publicExerciseCatalogues')[MANIFEST_ID];
  if (previousManifest && previousManifest.sourceSha256 !== sourceSha256)
    fail('Different previously active catalogue found: PR1 only supports initial publishing and same-hash idempotency');
  const exerciseMap = Object.fromEntries(exercises.map((row) => [row.id, {
    ...row, realmId: 'rlm-public', owner: null, sourceSha256,
  }]));
  const taxonomyMap = Object.fromEntries(Object.entries(taxonomy).map(([id, node]) => [id, {
    ...node, id, realmId: 'rlm-public', owner: null, sourceSha256,
  }]));
  const diff = diffExerciseRecords(getPublicTable(previous, 'publicExerciseDefinitions'), exerciseMap);
  const stage = { data: { 'rlm-public': {
    publicExerciseDefinitions: exerciseMap,
    publicExerciseTaxonomy: taxonomyMap,
  } } };
  const activate = { data: { 'rlm-public': { publicExerciseCatalogues: { [MANIFEST_ID]: {
    id: MANIFEST_ID, realmId: 'rlm-public', owner: null,
    schemaVersion: '2.0.0', catalogue: SOURCE_CATALOGUE,
    sourceSha256, exerciseCount: exercises.length,
    taxonomyCount: Object.keys(taxonomy).length,
    subcategoryLabelsRu: labels,
    movementFamilyReferences: source.movement_family_references,
    metadata: source.metadata, publishedAt,
  } } } } };
  const report = {
    schemaVersion: source.schema_version,
    sourceSha256,
    sourceIssues,
    exercises: exercises.length,
    taxonomy: Object.keys(taxonomy).length,
    diff: { added: diff.added.length, changed: diff.changed.length,
      unchanged: diff.unchanged.length, missing: diff.missing.length },
    missingIds: diff.missing,
    changedIds: diff.changed,
    note: 'Missing records are NOT deleted. Activate only after exporting and verifying staged rows.',
  };
  return { stage, activate, report };
}

async function main() {
  const opt = await parseArgs();
  const raw = await readFile(opt.source);
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== EXPECTED_SOURCE_SHA256) fail(`Source SHA-256 mismatch: ${digest}`);
  const source = JSON.parse(raw.toString('utf8'));
  const { exercises, taxonomy } = validateCatalogue(source);
  if (opt['verify-export']) {
    const exported = JSON.parse(await readFile(opt['verify-export'], 'utf8'));
    const remoteExercises = getPublicTable(exported, 'publicExerciseDefinitions');
    const remoteTaxonomy = getPublicTable(exported, 'publicExerciseTaxonomy');
    const expectedIds = new Set(exercises.map((x) => x.id));
    const matchingExercises = Object.entries(remoteExercises).filter(([id, rawRow]) =>
      normalizeExportedRow(id, rawRow)?.sourceSha256 === digest);
    const matchingTaxonomy = Object.entries(remoteTaxonomy).filter(([id, rawRow]) =>
      normalizeExportedRow(id, rawRow)?.sourceSha256 === digest);
    if (matchingExercises.length !== 1324 || matchingTaxonomy.length !== 69
      || matchingExercises.some(([id]) => !expectedIds.has(id))
      || matchingTaxonomy.some(([id]) => !(id in taxonomy)))
      fail(`Remote export incomplete: ${matchingExercises.length} exercises, ${matchingTaxonomy.length} taxonomy`);
    // Counts and a self-reported source hash are insufficient: independently
    // verify every canonical field before allowing manifest activation.
    for (const row of exercises) {
      const exported = normalizeExportedRow(row.id, remoteExercises[row.id]);
      if (!exported || exported.owner !== null || (exported.realmId !== undefined && exported.realmId !== 'rlm-public')
        || exported.sourceSha256 !== digest || Object.entries(row).some(
        ([key, value]) => !isDeepStrictEqual(exported[key], value),
      )) fail(`Remote exercise content mismatch: ${row.id}`);
    }
    for (const [id, node] of Object.entries(taxonomy)) {
      const exported = normalizeExportedRow(id, remoteTaxonomy[id]);
      if (!exported || exported.owner !== null || (exported.realmId !== undefined && exported.realmId !== 'rlm-public')
        || exported.sourceSha256 !== digest || Object.entries(node).some(
        ([key, value]) => !isDeepStrictEqual(exported[key], value),
      )) fail(`Remote taxonomy content mismatch: ${id}`);
    }
    console.log('Remote export content verified: 1324 exercises and 69 taxonomy nodes.');
    return;
  }
  if (!opt['out-dir']) fail('Specify --out-dir');
  if (Boolean(opt.previous) === Boolean(opt.assumeEmpty))
    fail('Specify exactly one: --previous <Dexie Cloud public export> or --assume-empty for verified fresh DB');
  const previous = opt.previous ? JSON.parse(await readFile(opt.previous, 'utf8')) : { data: { 'rlm-public': {} } };
  const prepared = await prepare(source, previous, new Date().toISOString());
  await mkdir(opt['out-dir'], { recursive: true });
  await Promise.all([
    writeFile(join(opt['out-dir'], '01-stage.json'), JSON.stringify(prepared.stage)),
    writeFile(join(opt['out-dir'], '02-activate-after-verification.json'), JSON.stringify(prepared.activate)),
    writeFile(join(opt['out-dir'], 'diff-report.json'), JSON.stringify(prepared.report, null, 2)),
  ]);
  console.log(JSON.stringify(prepared.report, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
