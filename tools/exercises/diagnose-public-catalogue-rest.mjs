#!/usr/bin/env node
/**
 * Read-only Dexie Cloud REST diagnostics for the three public exercise tables.
 * Requires only ACCESS_DB and GLOBAL_READ. No CLI admin export or write requests.
 * Raw records, API tokens and service-account credentials never leave memory.
 *
 * API: https://dexie.org/docs/cloud/rest-api
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_SOURCE_SHA256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const REALM = 'rlm-public';
const MANIFEST_ID = 'mezfit:exercise-catalogue';
const TABLES = Object.freeze({
  publicExerciseDefinitions: 1324,
  publicExerciseTaxonomy: 69,
  publicExerciseCatalogues: 1,
});

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseReadOnlyCredentials(raw, dbUrl) {
  let keys;
  try { keys = JSON.parse(raw); } catch { throw new Error('Dexie read-only GitHub secret is not valid JSON'); }
  const selected = record(keys) ? keys[dbUrl] : undefined;
  if (!record(selected) || typeof selected.clientId !== 'string' || !selected.clientId ||
      typeof selected.clientSecret !== 'string' || !selected.clientSecret) {
    throw new Error('Dexie read-only GitHub secret does not contain credentials for configured database');
  }
  return { clientId: selected.clientId, clientSecret: selected.clientSecret };
}

function urlFor(dbUrl, suffix) {
  const url = new URL(dbUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.dexie.cloud') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configured Dexie Cloud database URL is invalid');
  }
  return new URL(suffix, url).toString();
}

async function jsonResponse(response, action) {
  if (!response.ok) throw new Error(`Dexie ${action} failed (HTTP ${response.status})`);
  try { return await response.json(); } catch { throw new Error(`Dexie ${action} returned invalid JSON`); }
}

function rowsFromResponse(body, table) {
  // /all/table is an array. Accept the documented common response envelope
  // only when it contains an array; never turn an unknown shape into 0 rows.
  const rows = Array.isArray(body) ? body : record(body) && Array.isArray(body.data) ? body.data : null;
  if (!rows || rows.some(row => !record(row) || typeof row.id !== 'string' || row.realmId !== REALM)) {
    throw new Error(`Dexie ${table} returned unexpected public records`);
  }
  return rows;
}

export async function diagnosePublicCatalogueRest({ dbUrl, credentials, fetchFn = fetch }) {
  // Validate URL before ever sending credentials.
  const tokenUrl = urlFor(dbUrl, 'token');
  const response = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      scopes: ['ACCESS_DB', 'GLOBAL_READ'],
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const tokenResponse = await jsonResponse(response, 'token request');
  if (!record(tokenResponse) || typeof tokenResponse.accessToken !== 'string' || !tokenResponse.accessToken) {
    throw new Error('Dexie token response is missing accessToken');
  }
  const tables = {};
  let catalogueRows = [];
  for (const name of Object.keys(TABLES)) {
    const url = urlFor(dbUrl, `all/${encodeURIComponent(name)}?realmId=${encodeURIComponent(REALM)}`);
    const result = await fetchFn(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${tokenResponse.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (result.status === 404) {
      // A table not yet configured can yield 404; it must not be misreported as empty.
      tables[name] = { status: 'unavailable', count: null };
      continue;
    }
    const rows = rowsFromResponse(await jsonResponse(result, name), name);
    tables[name] = { status: 'ok', count: rows.length };
    if (name === 'publicExerciseCatalogues') catalogueRows = rows;
  }
  const manifest = catalogueRows.find(row => row.id === MANIFEST_ID);
  const manifestMatches = Boolean(manifest && manifest.schemaVersion === '2.0.0'
    && manifest.realmId === REALM && manifest.owner === null
    && manifest.sourceSha256 === EXPECTED_SOURCE_SHA256
    && manifest.exerciseCount === 1324 && manifest.taxonomyCount === 69);
  return {
    tables,
    manifest: tables.publicExerciseCatalogues.status === 'unavailable'
      ? 'unknown' : manifest ? manifestMatches ? 'matches' : 'unexpected' : 'absent',
    countsMatch: tables.publicExerciseDefinitions.count === TABLES.publicExerciseDefinitions
      && tables.publicExerciseTaxonomy.count === TABLES.publicExerciseTaxonomy,
  };
}

export function renderPublicCatalogueRestReport(result) {
  const lines = [
    '# Dexie Cloud public exercise catalogue — REST diagnostics',
    '',
    'Read-only server queries with ACCESS_DB and GLOBAL_READ; no export/import, schema edits or data writes.',
    'This report contains aggregate state only; raw objects and credentials are never published.',
    '',
    '| Public table | Query | Rows | Expected |',
    '| --- | --- | ---: | ---: |',
  ];
  for (const [name, expected] of Object.entries(TABLES)) {
    const state = result.tables[name];
    lines.push(`| ${name} | ${state.status} | ${state.count ?? 'unknown'} | ${expected} |`);
  }
  lines.push(
    '',
    `- Publication manifest: ${result.manifest}`,
    `- Exercise and taxonomy counts match 1324 / 69: ${result.countsMatch ? 'yes' : 'no / unknown'}`,
    '',
    '**This is not a cloud schema, role-permissions or source-content audit.**',
    'A 404 is reported as unavailable, not as an empty table. Before activation,',
    'a database manager must review cloud schema/permissions and verify staged',
    'content against the immutable source using `prepare-public-catalogue.mjs --verify-export`.',
    '',
  );
  return lines.join('\n');
}

async function main() {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error('Specify one output report.md path');
  const configUrl = new URL('../../dexie-cloud.json', import.meta.url);
  const config = JSON.parse(await readFile(configUrl, 'utf8'));
  if (!record(config) || typeof config.dbUrl !== 'string') throw new Error('Missing database URL');
  const credentials = parseReadOnlyCredentials(process.env.DEXIE_CLOUD_KEY_JSON || '', config.dbUrl);
  const report = renderPublicCatalogueRestReport(
    await diagnosePublicCatalogueRest({ dbUrl: config.dbUrl, credentials }),
  );
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await writeFile(output, report, { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Deliberately print only authored/sanitized errors, never responses or secrets.
    const message = error instanceof Error && /^Dexie |^Configured |^Missing |^Specify /.test(error.message)
      ? error.message : 'Read-only Dexie public catalogue diagnostic failed';
    console.error(message);
    process.exitCode = 1;
  });
}
