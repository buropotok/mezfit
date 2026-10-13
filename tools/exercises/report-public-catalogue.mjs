#!/usr/bin/env node
/**
 * Report only non-sensitive, aggregate state from Dexie Cloud CLI exports.
 * Raw exports and credentials are never printed or uploaded from public CI.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const PUBLIC_REALM = 'rlm-public';
const MANIFEST_ID = 'mezfit:exercise-catalogue';
const PUBLIC_TABLES = [
  'publicExerciseDefinitions',
  'publicExerciseTaxonomy',
  'publicExerciseCatalogues',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`Invalid Dexie export: ${label} must be an object`);
  return value;
}

function tableCount(realm, name) {
  if (realm[name] === undefined) return 0;
  return Object.keys(requireRecord(realm[name], `public table ${name}`)).length;
}

/**
 * Counts describe only the export state. They do not verify the completeness
 * or integrity of the exercises themselves, nor attest server-side ACLs.
 */
export function diagnosePublicCatalogue(schemaExport, rolesExport, dataExport) {
  const schema = requireRecord(requireRecord(schemaExport, 'schema export').schema, 'schema');
  const roles = requireRecord(requireRecord(rolesExport, 'roles export').roles, 'roles');
  const data = requireRecord(dataExport, 'data export');
  const exportedData = data.data === undefined ? {} : requireRecord(data.data, 'data');
  const realm = exportedData[PUBLIC_REALM] === undefined
    ? {} : requireRecord(exportedData[PUBLIC_REALM], PUBLIC_REALM);

  const tables = Object.fromEntries(PUBLIC_TABLES.map((name) => {
    const definition = schema[name];
    const primaryKey = typeof definition === 'string' ? definition.split(',')[0].trim() : null;
    return [name, {
      schemaPresent: primaryKey === 'id',
      records: tableCount(realm, name),
    }];
  }));
  const manifestTable = realm.publicExerciseCatalogues === undefined
    ? {} : requireRecord(realm.publicExerciseCatalogues, 'publicExerciseCatalogues');
  const manifest = manifestTable[MANIFEST_ID];
  if (manifest !== undefined) requireRecord(manifest, MANIFEST_ID);
  const expectedManifest = isRecord(manifest)
    && manifest.realmId === PUBLIC_REALM
    && manifest.owner === null
    && manifest.schemaVersion === '2.0.0'
    && manifest.sourceSha256 === EXPECTED_SHA
    && manifest.exerciseCount === 1324
    && manifest.taxonomyCount === 69;

  const actorWriteReferences = ['coach', 'client'].filter((name) => {
    if (!isRecord(roles[name])) return true;
    const permissions = roles[name].permissions;
    if (!isRecord(permissions)) return true;
    const serialized = JSON.stringify(permissions);
    return PUBLIC_TABLES.some((table) => serialized.includes(JSON.stringify(table)))
      || serialized.includes('"*"');
  });

  return {
    tables,
    manifestPresent: manifest !== undefined,
    expectedManifest,
    actorWriteReferences,
    recordCountsMatch: tables.publicExerciseDefinitions.records === 1324
      && tables.publicExerciseTaxonomy.records === 69,
  };
}

export function renderPublicCatalogueReport(result) {
  const lines = [
    '# Dexie Cloud public catalogue — read-only diagnostics',
    '',
    'This report contains aggregate counts only. No database rows, tokens, or raw exports are published.',
    '',
    '| Cloud table | Expected primary key | Schema matches | Exported rows |',
    '| --- | --- | --- | ---: |',
  ];
  for (const name of PUBLIC_TABLES) {
    const entry = result.tables[name];
    lines.push(`| ${name} | id | ${entry.schemaPresent ? 'yes' : 'NO'} | ${entry.records} |`);
  }
  lines.push(
    '',
    `- Publication manifest: ${result.manifestPresent ? 'present' : 'missing'}`,
    `- Manifest metadata matches expected release: ${result.expectedManifest ? 'yes' : 'NO'}`,
    `- Exercise and taxonomy counts match (1324 / 69): ${result.recordCountsMatch ? 'yes' : 'NO'}`,
    `- Coach/client role configuration contains public-table or wildcard write references: ${result.actorWriteReferences.length ? result.actorWriteReferences.join(', ') : 'none detected'}`,
    '',
    '**Not a permission audit or content verification.** Before activation, validate the full',
    'staged export against the immutable source JSON with `prepare-public-catalogue.mjs --verify-export`.',
    'Do not activate based on counts or this report alone.',
    '',
  );
  return lines.join('\n');
}

async function main() {
  const [schemaPath, rolesPath, dataPath, outputPath, ...extra] = process.argv.slice(2);
  if (!schemaPath || !rolesPath || !dataPath || !outputPath || extra.length) {
    throw new Error('Expected schema.json roles.json public.json report.md');
  }
  const [schema, roles, data] = await Promise.all([schemaPath, rolesPath, dataPath]
    .map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const report = renderPublicCatalogueReport(diagnosePublicCatalogue(schema, roles, data));
  await writeFile(outputPath, report, { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Never include export contents or key material in logs.
    console.error(error instanceof Error ? error.message : 'Unable to generate diagnostic report');
    process.exitCode = 1;
  });
}
