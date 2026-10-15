#!/usr/bin/env node
/**
 * Allowlisted, additive-only coach-exercise schema deployment.
 * Reuses the protected Dexie CLI credential preparation in manage.mjs.
 * No role, record or existing table modifications are permitted.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const COACH_SCHEMA_TABLES = Object.freeze([
  'coachExerciseOverrides',
  'coachExerciseDefinitions',
  'coachExerciseFavourites',
]);
const EXPECTED_URL = 'https://zjv60oxag.dexie.cloud';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

export function validateCoachSchemaManifest(manifest) {
  if (!record(manifest) || Object.keys(manifest).length !== 1
    || !Object.hasOwn(manifest, 'schema') || !record(manifest.schema)) {
    fail('INVALID_COACH_SCHEMA_MANIFEST');
  }
  const schema = manifest.schema;
  if (Object.keys(schema).length !== COACH_SCHEMA_TABLES.length
    || COACH_SCHEMA_TABLES.some(name => schema[name] !== 'id')) {
    fail('INVALID_COACH_SCHEMA_MANIFEST');
  }
  return schema;
}

function validateRemoteSchema(exported) {
  if (!record(exported) || !record(exported.schema)
    || Object.entries(exported.schema).some(([name, key]) => !name || typeof key !== 'string')) {
    fail('INVALID_REMOTE_COACH_SCHEMA');
  }
  return exported.schema;
}

export function planCoachSchema(manifest, remote) {
  const schema = validateCoachSchemaManifest(manifest);
  const installed = validateRemoteSchema(remote);
  const missing = {};
  for (const name of COACH_SCHEMA_TABLES) {
    if (Object.hasOwn(installed, name)) {
      if (installed[name] !== schema[name]) fail('INCOMPATIBLE_EXISTING_COACH_TABLE');
    } else {
      missing[name] = schema[name];
    }
  }
  return { missing, addedNames: Object.keys(missing) };
}

export function verifyCoachSchema(manifest, before, after, rolesBefore, rolesAfter) {
  const original = validateRemoteSchema(before);
  const actual = validateRemoteSchema(after);
  const { missing } = planCoachSchema(manifest, before);
  if (planCoachSchema(manifest, after).addedNames.length > 0) fail('INCOMPLETE_COACH_SCHEMA_IMPORT');
  if (!isDeepStrictEqual(actual, { ...original, ...missing })) fail('UNEXPECTED_COACH_SCHEMA_CHANGE');
  if (before.sealed !== after.sealed) fail('COACH_SCHEMA_SEAL_CHANGED');
  if (!record(rolesBefore) || !record(rolesBefore.roles)
    || !record(rolesAfter) || !record(rolesAfter.roles)
    || !isDeepStrictEqual(rolesBefore.roles, rolesAfter.roles)) {
    fail('COACH_ROLE_PERMISSIONS_CHANGED');
  }
}

const load = async filename => JSON.parse(await readFile(filename, 'utf8'));
const directory = () => {
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
    fail('GITHUB_RUNNER_REQUIRED');
  }
  return join(process.env.RUNNER_TEMP, 'dexie-schema-' + process.env.GITHUB_RUN_ID
    + '-' + process.env.GITHUB_RUN_ATTEMPT);
};

async function main() {
  const mode = process.argv[2];
  if (!['plan', 'verify'].includes(mode) || process.argv.length !== 3) fail('INVALID_OPERATION');
  const config = await load('dexie-cloud.json');
  if (!record(config) || config.dbUrl !== EXPECTED_URL) fail('UNEXPECTED_DATABASE_URL');

  const folder = directory();
  const manifest = await load('cloud/schema-coach-exercises.json');
  if (mode === 'plan') {
    const before = await load(join(folder, 'before-schema.json'));
    const plan = planCoachSchema(manifest, before);
    if (before.sealed === true && plan.addedNames.length > 0) fail('COACH_SCHEMA_SEALED');
    await writeFile(join(folder, 'schema-only-import.json'),
      JSON.stringify({ schema: plan.missing }), { flag: 'wx', mode: 0o600 });
    if (!process.env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await appendFile(process.env.GITHUB_OUTPUT, 'missing_count=' + plan.addedNames.length + '\n');
    console.log('Coach schema missing tables (' + plan.addedNames.length + '): '
      + (plan.addedNames.join(', ') || 'none'));
    console.log('Remote table count before: ' + Object.keys(before.schema).length);
    return;
  }

  const before = await load(join(folder, 'before-schema.json'));
  const after = await load(join(folder, 'after-schema.json'));
  verifyCoachSchema(manifest, before, after,
    await load(join(folder, 'before-roles.json')),
    await load(join(folder, 'after-roles.json')));
  console.log('Coach schema verified: three expected tables present, prior tables/keys, roles and seal unchanged.');
  console.log('Remote table count after: ' + Object.keys(after.schema).length);
}

if (process.argv[1]?.endsWith('/tools/dexie-schema/coach.mjs')) {
  main().catch(() => {
    // Never print third-party error bodies or credential-bearing exports.
    console.error('Coach Dexie schema operation failed; inspect workflow inputs and protected environment.');
    process.exitCode = 1;
  });
}
