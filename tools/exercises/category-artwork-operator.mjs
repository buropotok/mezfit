#!/usr/bin/env node
/** Single-table, schema-only protected Dexie Cloud operator. Never changes roles. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const DATABASE_URL = 'https://zjv60oxag.dexie.cloud';
export const CONFIRMATION = 'PUBLISH_PUBLIC_CATEGORY_ARTWORK_V1';
const TABLE = 'publicExerciseCategoryArtworks';
const PRIMARY_KEY = 'id';
const fail = code => { throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function authorizeCategoryArtworkOperation(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER)
    fail('UNAUTHORIZED_CATEGORY_ARTWORK_DISPATCH');
  if (!['preview', 'apply'].includes(env.CATEGORY_ARTWORK_OPERATION))
    fail('INVALID_CATEGORY_ARTWORK_OPERATION');
  if (env.CATEGORY_ARTWORK_OPERATION === 'apply') {
    if (env.CATEGORY_ARTWORK_CONFIRMATION !== CONFIRMATION) fail('INVALID_CATEGORY_ARTWORK_CONFIRMATION');
  } else if (env.CATEGORY_ARTWORK_CONFIRMATION) fail('PREVIEW_CANNOT_APPLY');
}

export function planCategoryArtworkSchema(manifest, beforeSchema, beforeRoles) {
  if (!isDeepStrictEqual(manifest, { schema: { [TABLE]: PRIMARY_KEY } }))
    fail('INVALID_CATEGORY_ARTWORK_SCHEMA_MANIFEST');
  if (!object(beforeSchema) || !object(beforeSchema.schema)
    || !object(beforeRoles) || !object(beforeRoles.roles)) fail('INVALID_CONFIGURATION_EXPORT');
  const current = beforeSchema.schema[TABLE];
  if (current !== undefined && current !== PRIMARY_KEY) fail('CONFLICTING_CATEGORY_ARTWORK_TABLE');
  return { missing: current === undefined ? { [TABLE]: PRIMARY_KEY } : {},
    count: current === undefined ? 1 : 0 };
}

export function verifyCategoryArtworkSchema(manifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planCategoryArtworkSchema(manifest, beforeSchema, beforeRoles);
  const expected = structuredClone(beforeSchema);
  expected.schema[TABLE] = PRIMARY_KEY;
  if (!isDeepStrictEqual(afterSchema, expected)) fail('UNEXPECTED_CATEGORY_ARTWORK_SCHEMA_READBACK');
  if (!isDeepStrictEqual(afterRoles, beforeRoles)) fail('CATEGORY_ARTWORK_ROLES_CHANGED');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
const workingDir = env => {
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT)
    fail('GITHUB_RUNNER_REQUIRED');
  return join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
};

async function main() {
  const mode = process.argv[2], env = process.env;
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode))
    fail('INVALID_CATEGORY_ARTWORK_COMMAND');
  authorizeCategoryArtworkOperation(env);
  if (mode === 'preflight') return;
  if ((await load('dexie-cloud.json')).dbUrl !== DATABASE_URL) fail('UNEXPECTED_DATABASE_URL');
  const dir = workingDir(env);
  const manifest = await load('cloud/schema-category-artwork.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planCategoryArtworkSchema(manifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'category-artwork-import.json'), JSON.stringify({ schema: plan.missing }),
      { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'missing_count=' + plan.count + '\n');
    console.log('Approved public category artwork table additions: ' + plan.count);
    return;
  }
  if (env.CATEGORY_ARTWORK_OPERATION !== 'apply') fail('APPLY_REQUIRED');
  if (mode === 'recheck') {
    if (!plan.count) fail('NO_SCHEMA_CHANGE_TO_APPLY');
    if (!isDeepStrictEqual(beforeSchema, await load(join(dir, 'current-schema.json')))
      || !isDeepStrictEqual(beforeRoles, await load(join(dir, 'current-roles.json')))
      || !isDeepStrictEqual({ schema: plan.missing }, await load(join(dir, 'category-artwork-import.json'))))
      fail('CATEGORY_ARTWORK_CONFIGURATION_CHANGED');
    return;
  }
  verifyCategoryArtworkSchema(manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')));
  console.log('Category artwork schema added or preserved; every role and other table unchanged.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'CATEGORY_ARTWORK_SCHEMA_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
