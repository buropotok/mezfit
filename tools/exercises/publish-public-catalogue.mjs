#!/usr/bin/env node
/**
 * Restricted, operator-only first publication of the immutable exercise catalogue.
 * The same read path powers preview/backup and publish; no schema administration.
 * No deletion or overwriting of conflicting existing objects is permitted.
 *
 * Dexie Cloud REST: https://dexie.org/docs/cloud/rest-api
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseReadOnlyCredentials } from './diagnose-public-catalogue-rest.mjs';
import { prepare, validateCatalogue } from './prepare-public-catalogue.mjs';

const DATABASE_URL = 'https://zjv60oxag.dexie.cloud';
const REALM = 'rlm-public';
const EXPECTED_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const MANIFEST_ID = 'mezfit:exercise-catalogue';
const EXPECTED_COUNTS = Object.freeze({
  publicExerciseDefinitions: 1324,
  publicExerciseTaxonomy: 69,
  publicExerciseCatalogues: 1,
});
const STAGE_TABLES = ['publicExerciseDefinitions', 'publicExerciseTaxonomy'];
const BATCH_SIZE = 25;

function error(message) { throw new Error(message); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeDatabaseUrl(url) {
  if (url !== DATABASE_URL) error('Refusing unexpected Dexie Cloud database URL');
  return url;
}

function parseResponseRows(payload, table) {
  const rows = Array.isArray(payload) ? payload : record(payload) && Array.isArray(payload.data) ? payload.data : null;
  if (!rows) error(`Unexpected Dexie response for ${table}`);
  const ids = new Set();
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
        || row.realmId !== REALM) error(`Invalid public rows in ${table}`);
    ids.add(row.id);
  }
  return rows;
}

async function asJson(response, action) {
  if (!response.ok) error(`Dexie ${action} failed with HTTP ${response.status}`);
  try { return await response.json(); } catch { error(`Dexie ${action} returned invalid JSON`); }
}

export async function openPublicSession({ dbUrl, rawKey, mode, fetchFn = fetch }) {
  safeDatabaseUrl(dbUrl);
  const { clientId, clientSecret } = parseReadOnlyCredentials(rawKey, dbUrl);
  const scopes = mode === 'publish' || mode === 'backup'
    ? ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE']
    : mode === 'preview' ? ['ACCESS_DB', 'GLOBAL_READ'] : error('Invalid publication operation');
  const response = await fetchFn(`${dbUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', scopes,
      client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(20000),
  });
  const token = await asJson(response, 'token');
  if (!record(token) || typeof token.accessToken !== 'string' || !token.accessToken)
    error('Dexie token response is invalid');
  const headers = { authorization: `Bearer ${token.accessToken}` };
  return {
    async list(table) {
      if (!(table in EXPECTED_COUNTS)) error('Forbidden public catalogue table');
      const response = await fetchFn(
        `${dbUrl}/all/${table}?realmId=${encodeURIComponent(REALM)}`,
        { method: 'GET', headers, signal: AbortSignal.timeout(30000) });
      return parseResponseRows(await asJson(response, table), table);
    },
    async put(table, rows) {
      if (mode !== 'publish' || !(table in EXPECTED_COUNTS) ||
          !Array.isArray(rows) || rows.length === 0 || rows.length > BATCH_SIZE
          || rows.some(row => !record(row) || typeof row.id !== 'string' ||
            row.realmId !== REALM || row.owner !== null)) error('Unsafe publication write');
      const response = await fetchFn(`${dbUrl}/all/${table}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) error(`Dexie ${table} publication failed with HTTP ${response.status}`);
    },
  };
}

async function fetchPublicRows(session) {
  const tables = {};
  for (const table of Object.keys(EXPECTED_COUNTS)) tables[table] = await session.list(table);
  return tables;
}
function mapById(rows) { return Object.fromEntries(rows.map(row => [row.id, row])); }
function previousExport(tables) {
  return { data: { [REALM]: Object.fromEntries(Object.entries(tables)
    .map(([name, rows]) => [name, mapById(rows)])) } };
}
function matchesExpected(actual, expected) {
  return record(actual) && Object.entries(expected).every(
    ([key, value]) => isDeepStrictEqual(actual[key], value));
}

export function publicationPlan(current, prepared) {
  const expected = prepared.stage.data[REALM];
  const missing = {};
  for (const name of STAGE_TABLES) {
    const actual = mapById(current[name]);
    const required = expected[name];
    for (const [id, value] of Object.entries(actual)) {
      if (!(id in required)) error(`Unexpected existing public row in ${name}; refusing changes`);
      if (!matchesExpected(value, required[id]))
        error(`Conflicting existing public row in ${name}; refusing overwrite`);
    }
    missing[name] = Object.values(required).filter(row => !(row.id in actual));
  }
  const manifests = current.publicExerciseCatalogues;
  if (manifests.length > 1 || manifests.some(row => row.id !== MANIFEST_ID))
    error('Unexpected existing public catalogue manifests');
  const expectedManifest = prepared.activate.data[REALM].publicExerciseCatalogues[MANIFEST_ID];
  const active = manifests[0];
  if (active && (!matchesExpected(active, { ...expectedManifest, publishedAt: active.publishedAt })
      || typeof active.publishedAt !== 'string' || !active.publishedAt)) {
    error('Existing active catalogue differs from expected release');
  }
  if (active && STAGE_TABLES.some(name => missing[name].length))
    error('Published catalogue is missing records; refusing to mutate live release');
  return {
    missing,
    alreadyActive: Boolean(active),
    expectedManifest,
    existingCounts: Object.fromEntries(Object.entries(current)
      .map(([name, rows]) => [name, rows.length])),
  };
}

async function verifyAll(session, prepared) {
  const expected = prepared.stage.data[REALM];
  const verified = await fetchPublicRows(session);
  for (const name of STAGE_TABLES) {
    const rows = verified[name];
    if (rows.length !== EXPECTED_COUNTS[name]) error(`Staged ${name} count mismatch`);
    const found = mapById(rows);
    for (const [id, row] of Object.entries(expected[name])) {
      if (!matchesExpected(found[id], row)) error(`Staged ${name} content mismatch`);
    }
  }
  return verified;
}

export async function runPublicCatalogue({ sourceBytes, dbUrl, rawKey, mode,
  backupApproved = false, fetchFn = fetch }) {
  safeDatabaseUrl(dbUrl);
  const digest = createHash('sha256').update(sourceBytes).digest('hex');
  if (digest !== EXPECTED_SHA) error('R2 source SHA-256 mismatch; refusing publication');
  const source = JSON.parse(sourceBytes.toString('utf8'));
  validateCatalogue(source);
  const session = await openPublicSession({ dbUrl, rawKey, mode, fetchFn });
  const current = await fetchPublicRows(session);
  const prepared = await prepare(source, previousExport(current), new Date().toISOString());
  const plan = publicationPlan(current, prepared);

  if (mode === 'preview') {
    return { status: 'preview', counts: plan.existingCounts,
      toStage: Object.fromEntries(STAGE_TABLES.map(name => [name, plan.missing[name].length])),
      alreadyActive: plan.alreadyActive };
  }
  if (mode === 'backup') return { status: 'backup', payload: previousExport(current),
    counts: plan.existingCounts };
  if (mode !== 'publish' || !backupApproved) error('Publishing requires confirmed private R2 backup');

  if (!plan.alreadyActive) {
    for (const name of STAGE_TABLES) {
      for (let i = 0; i < plan.missing[name].length; i += BATCH_SIZE) {
        await session.put(name, plan.missing[name].slice(i, i + BATCH_SIZE));
      }
    }
  }
  await verifyAll(session, prepared);
  if (!plan.alreadyActive) {
    // This is the only activation write. No manifest exists until all 1393 rows match.
    await session.put('publicExerciseCatalogues', [plan.expectedManifest]);
  }
  const manifests = await session.list('publicExerciseCatalogues');
  if (manifests.length !== 1 || manifests[0].id !== MANIFEST_ID ||
      !matchesExpected(manifests[0], { ...plan.expectedManifest,
        publishedAt: plan.alreadyActive ? manifests[0].publishedAt : plan.expectedManifest.publishedAt }))
    error('Publication manifest verification failed');
  return { status: plan.alreadyActive ? 'already-active' : 'published',
    exercises: 1324, taxonomy: 69, manifest: 'verified' };
}

function options(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!['--mode','--source','--out'].includes(name) || !args[i+1] || name in opt)
      error('Invalid catalogue publisher arguments');
    opt[name] = args[i+1];
  }
  if (!['preview','backup','publish'].includes(opt['--mode']) || !opt['--source'])
    error('Missing publisher mode/source');
  if ((opt['--mode'] === 'backup') !== Boolean(opt['--out']))
    error('Backup requires --out and other modes forbid --out');
  return opt;
}

async function main() {
  const opt = options(process.argv.slice(2));
  const mode = opt['--mode'];
  const config = JSON.parse(await readFile(new URL('../../dexie-cloud.json', import.meta.url)));
  const rawKey = mode === 'preview' ? process.env.DEXIE_CLOUD_KEY_JSON
    : process.env.DEXIE_CLOUD_WRITE_KEY;
  if (!rawKey) error('Missing Dexie service-account secret for selected operation');
  const sourceBytes = await readFile(opt['--source']);
  const outcome = await runPublicCatalogue({ sourceBytes, dbUrl: config.dbUrl,
    rawKey, mode, backupApproved: process.env.DEXIE_PRIVATE_R2_BACKUP_READY === 'yes' });
  if (mode === 'backup') {
    await writeFile(opt['--out'], JSON.stringify(outcome.payload), { flag: 'wx', mode: 0o600 });
    console.log('Private backup prepared for R2 upload; counts verified');
  } else {
    console.log(JSON.stringify(outcome));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Never echo upstream response bodies, raw data, credentials, or detailed IDs.
    console.error('Dexie catalogue operation failed; no activation is attempted after an error');
    process.exitCode = 1;
  });
}
