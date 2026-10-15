#!/usr/bin/env node
/**
 * Schema-only Dexie Cloud operator for the protected manual GitHub workflow.
 * The existing publisher service account is used without a new key.
 */
import { readFile, mkdir, writeFile, appendFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const EXPECTED_TABLES = Object.freeze([
  'programPhases', 'programDays', 'programExercises', 'programSets',
  'workoutOccurrences', 'sessionExercises', 'sessionFactExercises', 'sessionFactSets',
]);
const EXPECTED_URL = 'https://zjv60oxag.dexie.cloud';

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message) { throw new Error(message); }

export function validateManifest(value) {
  if (!record(value) || Object.keys(value).join(',') !== 'schema'
    || !record(value.schema) || Object.keys(value.schema).length !== EXPECTED_TABLES.length
    || EXPECTED_TABLES.some(name => value.schema[name] !== '@id')) {
    fail('INVALID_ADDITIVE_SCHEMA_MANIFEST');
  }
  return value.schema;
}

export function planAdditiveSchema(manifest, remote) {
  const wanted = validateManifest(manifest);
  if (!record(remote) || !record(remote.schema)) fail('INVALID_REMOTE_SCHEMA');
  const missing = {};
  for (const name of EXPECTED_TABLES) {
    if (Object.hasOwn(remote.schema, name)) {
      if (remote.schema[name] !== wanted[name]) fail('INCOMPATIBLE_EXISTING_SCHEMA_TABLE');
    } else missing[name] = wanted[name];
  }
  return { missing, addedNames: Object.keys(missing) };
}

export function verifyAdditiveSchema(manifest, before, after, rolesBefore, rolesAfter) {
  if (!record(before) || !record(before.schema) || !record(after) || !record(after.schema)) {
    fail('INVALID_REMOTE_SCHEMA');
  }
  if (planAdditiveSchema(manifest, after).addedNames.length !== 0) fail('INCOMPLETE_SCHEMA_IMPORT');
  for (const [name, value] of Object.entries(before.schema)) {
    if (!Object.hasOwn(after.schema, name) || after.schema[name] !== value) {
      fail('UNEXPECTED_SCHEMA_CHANGE');
    }
  }
  if (before.sealed !== after.sealed) fail('SCHEMA_SEAL_CHANGED');
  if (!record(rolesBefore) || !record(rolesBefore.roles)
    || !record(rolesAfter) || !record(rolesAfter.roles)
    || !isDeepStrictEqual(rolesBefore.roles, rolesAfter.roles)) fail('ROLE_PERMISSIONS_CHANGED');
}

/** Report complete schema/role maps without exporting business records or credential metadata. */
export function formatCloudStructureReport(schemaExport, rolesExport) {
  if (!record(schemaExport) || !record(schemaExport.schema) || !record(rolesExport)
    || !record(rolesExport.roles)) fail('INVALID_CLOUD_STRUCTURE_EXPORT');
  const schema = schemaExport.schema;
  const roles = rolesExport.roles;
  if (Object.entries(schema).some(([key, value]) => !key || typeof value !== 'string')
    || Object.keys(roles).some(key => !key)) fail('INVALID_CLOUD_STRUCTURE_EXPORT');
  return [
    'DEXIE CLOUD STRUCTURE (read-only; no business records)',
    'Tables (' + Object.keys(schema).length + '):',
    JSON.stringify(schema, null, 2),
    'Schema sealed: ' + JSON.stringify(schemaExport.sealed ?? null),
    'Roles (' + Object.keys(roles).length + '):',
    JSON.stringify(roles, null, 2),
    'NOTE: This is schema and role configuration, not a live per-user permission or realm membership audit.',
  ].join('\\n');
}

const workdir = () => {
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
    fail('GITHUB_RUNNER_REQUIRED');
  }
  return join(process.env.RUNNER_TEMP, 'dexie-schema-' + process.env.GITHUB_RUN_ID
    + '-' + process.env.GITHUB_RUN_ATTEMPT);
};
const load = async file => JSON.parse(await readFile(file, 'utf8'));

async function main() {
  const mode = process.argv[2];
  if (!['prepare', 'plan', 'verify', 'report'].includes(mode) || process.argv.length !== 3) {
    fail('INVALID_OPERATION');
  }
  const config = await load('dexie-cloud.json');
  if (!record(config) || config.dbUrl !== EXPECTED_URL) fail('UNEXPECTED_DATABASE_URL');
  const directory = workdir();

  if (mode === 'prepare') {
    let secret;
    try { secret = JSON.parse(process.env.DEXIE_CLOUD_WRITE_KEY || ''); }
    catch { fail('PUBLISHER_SECRET_MISSING_OR_INVALID'); }
    const credentials = record(secret) ? secret[EXPECTED_URL] : null;
    if (!record(credentials) || typeof credentials.clientId !== 'string'
      || !credentials.clientId || typeof credentials.clientSecret !== 'string'
      || !credentials.clientSecret) fail('PUBLISHER_SECRET_MISSING_OR_INVALID');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(join(directory, 'dexie-cloud.key'),
      JSON.stringify({ [EXPECTED_URL]: credentials }), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'dexie-cloud.json'),
      JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    console.log('Isolated Dexie Cloud CLI configuration ready.');
    return;
  }

  if (mode === 'report') {
    console.log(formatCloudStructureReport(
      await load(join(directory, 'before-schema.json')),
      await load(join(directory, 'before-roles.json'))));
    return;
  }

  const manifest = await load('cloud/schema-workout-foundation.json');
  if (mode === 'plan') {
    const remote = await load(join(directory, 'before-schema.json'));
    const plan = planAdditiveSchema(manifest, remote);
    await writeFile(join(directory, 'schema-only-import.json'),
      JSON.stringify({ schema: plan.missing }), { flag: 'wx', mode: 0o600 });
    if (!process.env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await appendFile(process.env.GITHUB_OUTPUT, 'missing_count=' + plan.addedNames.length + '\n');
    console.log('Missing tables (' + plan.addedNames.length + '): '
      + (plan.addedNames.join(', ') || 'none'));
    return;
  }
  verifyAdditiveSchema(manifest,
    await load(join(directory, 'before-schema.json')),
    await load(join(directory, 'after-schema.json')),
    await load(join(directory, 'before-roles.json')),
    await load(join(directory, 'after-roles.json')));
  console.log('Verified all workout v4 tables; existing schema and roles unchanged.');
}

if (process.argv[1]?.endsWith('/tools/dexie-schema/manage.mjs')) {
  main().catch(() => {
    // Never emit third-party error bodies that could include secrets.
    console.error('Dexie schema operation failed; inspect the protected job and CLI permissions.');
    process.exitCode = 1;
  });
}
