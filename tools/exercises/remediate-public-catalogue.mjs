#!/usr/bin/env node
/**
 * REM-01: manual, versioned correction of SIX existing public exercise records.
 * No source/R2 rewrite, no additions, deletes, ID/realm/owner/media/tracking changes.
 * Pending editorial review intentionally blocks publish; preview remains read-only.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openPublicSession } from './publish-public-catalogue.mjs';
import { validateCatalogue } from './prepare-public-catalogue.mjs';
import { TRACKING_RELEASE_SHA256, TRACKING_SCHEMA_VERSION } from './restore-legacy-tracking.mjs';

const SOURCE_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const DATABASE_URL = 'https://zjv60oxag.dexie.cloud';
const REALM = 'rlm-public';
const MANIFEST_ID = 'mezfit:exercise-catalogue';
const FIELDS = Object.freeze({
  '3637': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'name_ru', 'name_en', 'name'],
  '3235': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3291': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3292': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'subcategory', 'subcategory_ru'],
  '3315': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3638': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'name_ru', 'name_en', 'name'],
});
const IDS = Object.keys(FIELDS);
const COUNTS = Object.freeze({
  publicExerciseDefinitions: 1324, publicExerciseTaxonomy: 69, publicExerciseCatalogues: 1,
});
const PROPOSAL_URL = new URL('../../audit/visual/remediation/REM-01-proposed-corrections.json', import.meta.url);

function fail(message) { throw new Error(message); }
function isRecord(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function at(row, path) { return path.split('.').reduce((value, key) => value?.[key], row); }
function setAt(row, path, value) {
  const keys = path.split('.');
  let node = row;
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(node[key])) fail('Unexpected replacement container');
    node = node[key];
  }
  node[keys.at(-1)] = structuredClone(value);
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
/** The audited GitHub projections are lossless at the object level, not byte-identical to the R2 JSON. */
async function readAuditedSource(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (manifest.source_catalogue_sha256 !== SOURCE_SHA || manifest.records !== 1324
    || !Array.isArray(manifest.stages) || manifest.stages.length !== 14)
    fail('Unexpected audited catalogue manifest');
  const exercises = [];
  for (let index = 0; index < 14; index++) {
    const stage = manifest.stages[index];
    const filename = 'catalogue_stage_' + String(index + 1).padStart(2, '0') + '.jsonl';
    if (stage.stage !== index + 1 || stage.file !== 'input/' + filename
      || stage.count !== (index === 13 ? 24 : 100)
      || !/^[a-f0-9]{64}$/.test(stage.sha256)) fail('Invalid audited stage manifest');
    const bytes = await readFile(join(dir, filename));
    if (digest(bytes) !== stage.sha256) fail('Audited catalogue stage SHA-256 mismatch: ' + filename);
    const rows = bytes.toString('utf8').trimEnd().split('\\n').map(line => JSON.parse(line));
    if (rows.length !== stage.count) fail('Audited stage count mismatch: ' + filename);
    exercises.push(...rows);
  }
  const root = JSON.parse(await readFile(join(dir, 'taxonomy.json'), 'utf8'));
  if (!root || Object.hasOwn(root, 'exercises') || root.schema_version !== '2.0.0'
    || exercises.length !== 1324) fail('Invalid audited catalogue root');
  const source = { ...root, exercises };
  validateCatalogue(source);
  return source;
}
function table(rows, expected, name) {
  if (!Array.isArray(rows) || rows.length !== expected) fail('Wrong public table size: ' + name);
  const map = new Map();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string' || map.has(row.id)
      || row.realmId !== REALM || row.owner !== null || row.sourceSha256 !== SOURCE_SHA)
      fail('Unexpected public row in ' + name);
    map.set(row.id, row);
  }
  return map;
}
function currentTables(data) {
  if (!isRecord(data)) fail('Missing public table export');
  return {
    definitions: table(data.publicExerciseDefinitions, 1324, 'definitions'),
    taxonomy: table(data.publicExerciseTaxonomy, 69, 'taxonomy'),
    manifests: table(data.publicExerciseCatalogues, 1, 'manifest'),
  };
}
function checkProposal(source, patch) {
  if (!isRecord(patch) || patch.batch_id !== 'REM-01' || patch.exercise_count !== 6
    || patch.source_catalogue_sha256 !== SOURCE_SHA || patch.target !== 'publicExerciseDefinitions'
    || patch.automatic_application_permitted !== false
    || !['editorial_review_pending', 'approved'].includes(patch.approval_state)
    || !Array.isArray(patch.expected_exercise_ids)
    || !isDeepStrictEqual(patch.expected_exercise_ids.slice().sort(), IDS.slice().sort())
    || !Array.isArray(patch.exercises) || patch.exercises.length !== 6) fail('Unexpected REM-01 proposal');
  const original = new Map(source.exercises.map(row => [row.id, row]));
  const result = new Map();
  for (const item of patch.exercises) {
    if (!isRecord(item) || !Object.hasOwn(FIELDS, item.id) || result.has(item.id)
      || item.audit_status !== 'confirmed_mismatch' || item.audit_priority !== 'P0'
      || !isRecord(item.field_replacements)
      || !isDeepStrictEqual(Object.keys(item.field_replacements).sort(), FIELDS[item.id].slice().sort()))
      fail('Unexpected exercise or field allowlist');
    const sourceRow = original.get(item.id);
    if (!sourceRow || item.applied !== false || !['pending', 'approved'].includes(item.approval_state)
      || item.original_name_ru !== sourceRow.name_ru
      || item.original_name_en !== sourceRow.name_en || item.gif_url !== sourceRow.gif_url)
      fail('REM-01 exercise provenance mismatch');
    if (FIELDS[item.id].includes('name') &&
      (item.proposed_name_ru !== item.field_replacements.name_ru.proposed_value
       || item.proposed_name_en !== item.field_replacements.name_en.proposed_value))
      fail('Proposed names differ from field replacements');
    for (const field of FIELDS[item.id]) {
      const change = item.field_replacements[field];
      const originalValue = at(sourceRow, field);
      const validReplacement = typeof originalValue === 'string'
        ? typeof change?.proposed_value === 'string' && change.proposed_value.trim().length > 0
        : Array.isArray(originalValue) && Array.isArray(change?.proposed_value)
          && change.proposed_value.length > 0
          && change.proposed_value.every(x => typeof x === 'string' && x.trim().length > 0);
      if (!isRecord(change) || !isDeepStrictEqual(originalValue, change.expected_current)
        || isDeepStrictEqual(change.expected_current, change.proposed_value)
        || !validReplacement) fail('Unsafe or ungrounded proposed value');
    }
    for (const lang of ['ru', 'en']) {
      const steps = item.field_replacements['instruction_steps.' + lang].proposed_value;
      const instruction = item.field_replacements['instructions.' + lang].proposed_value;
      if (steps.join(' ') !== instruction) fail('Instructions and steps diverge');
    }
    if (FIELDS[item.id].includes('name') &&
      item.field_replacements.name.proposed_value !== item.field_replacements.name_ru.proposed_value)
      fail('Name and Russian label diverge');
    if (FIELDS[item.id].includes('subcategory') &&
      source.subcategory_labels_ru[item.field_replacements.subcategory.proposed_value]
        !== item.field_replacements.subcategory_ru.proposed_value)
      fail('Subcategory translation is not canonical');
    result.set(item.id, { item, sourceRow });
  }
  if (result.size !== 6) fail('Missing REM-01 ID');
  return result;
}
function checkLiveRows(tables, source) {
  const sourceExercises = new Map(source.exercises.map(row => [row.id, row]));
  if (tables.definitions.size !== sourceExercises.size) fail('Unexpected exercise count');
  for (const [id, row] of tables.definitions) {
    if (!sourceExercises.has(id)) fail('Unknown public exercise ID');
    if (row.id !== id) fail('Invalid public exercise ID');
  }
  for (const [id, node] of Object.entries(source.taxonomy)) {
    const actual = tables.taxonomy.get(id);
    if (!actual || !Object.entries(node).every(([key, value]) => isDeepStrictEqual(actual[key], value)))
      fail('Public taxonomy differs from pinned source');
  }
  const active = tables.manifests.get(MANIFEST_ID);
  if (!active || active.schemaVersion !== '2.0.0' || active.exerciseCount !== 1324
    || active.taxonomyCount !== 69 || typeof active.publishedAt !== 'string')
    fail('Unexpected public catalogue manifest');
  const hasTracking = Object.hasOwn(active, 'trackingSchemaVersion')
    || Object.hasOwn(active, 'trackingReleaseSha256');
  if (hasTracking && (active.trackingSchemaVersion !== TRACKING_SCHEMA_VERSION
    || active.trackingReleaseSha256 !== TRACKING_RELEASE_SHA256))
    fail('Unexpected tracking marker on public catalogue');
  return active;
}

/** Pure plan; may be used by tests with synthetic live public tables. */
export function remediationPlan(current, source, patch, patchSha256) {
  validateCatalogue(source);
  if (!/^[0-9a-f]{64}$/.test(patchSha256)) fail('Missing proposal digest');
  const changes = checkProposal(source, patch);
  const tables = currentTables(current);
  const manifest = checkLiveRows(tables, source);
  const activated = Object.hasOwn(manifest, 'remediationReleaseId')
    || Object.hasOwn(manifest, 'remediationReleaseSha256');
  if (activated && (manifest.remediationReleaseId !== 'REM-01'
    || manifest.remediationReleaseSha256 !== patchSha256))
    fail('Different remediation release is already active');
  const updates = [];
  for (const [id, { item, sourceRow }] of changes) {
    const actual = tables.definitions.get(id);
    if (!actual) fail('Missing REM-01 public row');
    const changedRoots = new Set(FIELDS[id].map(field => field.split('.')[0]));
    for (const root of ['instructions', 'instruction_steps']) {
      if (!isRecord(actual[root]) || !isDeepStrictEqual(
        Object.keys(actual[root]).sort(), Object.keys(sourceRow[root]).sort()))
        fail('Unexpected nested instruction fields');
    }
    for (const [key, value] of Object.entries(sourceRow)) {
      if (!changedRoots.has(key) && !isDeepStrictEqual(actual[key], value))
        fail('Unrelated canonical field has changed');
    }
    const oldOrNew = FIELDS[id].map(field => {
      const live = at(actual, field), proposal = item.field_replacements[field];
      if (isDeepStrictEqual(live, proposal.expected_current)) return 'old';
      if (isDeepStrictEqual(live, proposal.proposed_value)) return 'new';
      fail('Live value conflicts with reviewed REM-01 proposal');
    });
    if (new Set(oldOrNew).size !== 1) fail('Partially modified exercise requires manual review');
    if (oldOrNew[0] === 'old') {
      const next = structuredClone(actual);
      for (const field of FIELDS[id]) setAt(next, field, item.field_replacements[field].proposed_value);
      updates.push(next);
    }
  }
  if (activated && updates.length) fail('Activated release contains outdated rows');
  return { updates, activated, snapshot: structuredClone(current), manifest: structuredClone(manifest),
    patchSha256, approved: patch.approval_state === 'approved'
      && [...changes.values()].every(({ item }) => item.approval_state === 'approved') };
}
async function readPublic(session) {
  const current = {};
  for (const table of Object.keys(COUNTS)) {
    current[table] = (await session.list(table)).sort((a, b) => a.id.localeCompare(b.id));
  }
  return current;
}
function backupPayload(snapshot) {
  return { data: { [REALM]: Object.fromEntries(Object.entries(snapshot).map(
    ([name, rows]) => [name, Object.fromEntries(rows.map(row => [row.id, row]))],
  )) } };
}
export async function executeRemediation({ session, source, patch, patchSha256, backupApproved, backupDigest }) {
  if (!backupApproved || patch.approval_state !== 'approved'
    || patch.exercises.some(item => item.approval_state !== 'approved'))
    fail('REM-01 requires confirmed GitHub artifact backup and approved editorial values');
  const before = await readPublic(session);
  if (!backupDigest || digest(Buffer.from(JSON.stringify(backupPayload(before)))) !== backupDigest)
    fail('Live public state differs from successfully uploaded backup');
  const plan = remediationPlan(before, source, patch, patchSha256);
  if (!plan.approved) fail('Editorial approval is missing');
  // Repeat the full remote read immediately before mutation, including 1318 untouched rows.
  if (!isDeepStrictEqual(before, await readPublic(session))) fail('Public catalogue changed since preflight');
  if (plan.updates.length) await session.put('publicExerciseDefinitions', plan.updates);
  const after = await readPublic(session);
  const expected = structuredClone(before);
  const changed = new Map(plan.updates.map(row => [row.id, row]));
  expected.publicExerciseDefinitions = expected.publicExerciseDefinitions.map(row => changed.get(row.id) ?? row);
  if (!isDeepStrictEqual(after, expected))
    fail('REM-01 readback differs; manifest was NOT activated');
  if (!plan.activated) {
    const manifest = { ...plan.manifest, remediationReleaseId: 'REM-01',
      remediationReleaseSha256: patchSha256, publishedAt: new Date().toISOString() };
    await session.put('publicExerciseCatalogues', [manifest]);
    const final = await readPublic(session);
    expected.publicExerciseCatalogues = [manifest];
    if (!isDeepStrictEqual(final, expected)) fail('REM-01 manifest or catalogue readback mismatch');
  }
  return { status: plan.activated ? 'already-active' : 'published',
    updated: plan.updates.length, verifiedExercises: 1324, verifiedTaxonomy: 69 };
}
export async function runRemediation({ sourceBytes, proposalBytes, dbUrl, rawKey, mode,
  backupApproved = false, backupDigest, source, fetchFn = fetch }) {
  if (dbUrl !== DATABASE_URL || !['preview', 'backup', 'publish'].includes(mode))
    fail('Invalid remediation operation/database');
  if (!source) {
    if (digest(sourceBytes) !== SOURCE_SHA) fail('Immutable source SHA-256 mismatch');
    source = JSON.parse(sourceBytes.toString('utf8'));
  }
  const patch = JSON.parse(proposalBytes.toString('utf8'));
  const patchSha256 = digest(proposalBytes);
  const session = await openPublicSession({ dbUrl, rawKey, mode, fetchFn });
  const current = await readPublic(session);
  const plan = remediationPlan(current, source, patch, patchSha256);
  if (mode === 'preview') return { status: 'preview', batch: 'REM-01', totalIds: 6,
    pending: plan.updates.length, alreadyCorrect: 6 - plan.updates.length,
    editorApproved: plan.approved, publishAllowed: plan.approved, proposalSha256: patchSha256 };
  if (mode === 'backup') return { status: 'backup', payload: backupPayload(current) };
  return executeRemediation({ session, source, patch, patchSha256, backupApproved, backupDigest });
}
function options(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--mode', '--source', '--source-dir', '--out', '--backup-file'].includes(args[i]) || !args[i + 1]
      || Object.hasOwn(opt, args[i])) fail('Unexpected CLI argument');
    opt[args[i]] = args[i + 1];
  }
  if (!['preview', 'backup', 'publish'].includes(opt['--mode']) || (Boolean(opt['--source']) === Boolean(opt['--source-dir']))
    || ((opt['--mode'] === 'backup') !== Boolean(opt['--out']))
    || ((opt['--mode'] === 'publish') !== Boolean(opt['--backup-file'])))
    fail('Missing/invalid REM-01 CLI arguments');
  return opt;
}
async function main() {
  const opt = options(process.argv.slice(2));
  const config = JSON.parse(await readFile(new URL('../../dexie-cloud.json', import.meta.url)));
  const mode = opt['--mode'];
  const rawKey = mode === 'preview' ? process.env.DEXIE_CLOUD_KEY_JSON : process.env.DEXIE_CLOUD_WRITE_KEY;
  if (!rawKey) fail('Missing Dexie credential for this operation');
  const source = opt['--source-dir'] ? await readAuditedSource(opt['--source-dir']) : undefined;
  const backupDigest = opt['--backup-file'] ? digest(await readFile(opt['--backup-file'])) : undefined;
  const result = await runRemediation({ sourceBytes: source ? undefined : await readFile(opt['--source']), source, backupDigest,
    proposalBytes: await readFile(PROPOSAL_URL), dbUrl: config.dbUrl, rawKey, mode,
    backupApproved: process.env.DEXIE_GITHUB_ARTIFACT_BACKUP_READY === 'yes' });
  if (mode === 'backup') {
    await writeFile(opt['--out'], JSON.stringify(result.payload), { flag: 'wx', mode: 0o600 });
    console.log('REM-01 private backup generated');
  } else console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('REM-01 operation refused or failed; inspect preview/backup/readback');
    process.exitCode = 1;
  });
}
