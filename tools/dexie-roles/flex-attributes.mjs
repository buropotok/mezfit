#!/usr/bin/env node
/** Protected, exact additive Flex Attributes schema + Coach/Client ACL operator. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EXPECTED_CLIENT_SESSION_ROLES } from './client-sessions.mjs';

export const CONFIRMATION = 'APPLY_FLEX_ATTRIBUTES_SCHEMA_AND_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const FLEX_SCHEMA = deepFreeze({ schema: { flexAttributes: 'id', flexValues: 'id' } });
export const FLEX_ROLE_OVERLAY = deepFreeze({
  roles: {
    coach: { permissions: { add: ['flexAttributes', 'flexValues'], update: { flexValues: ['value'] } } },
    client: { permissions: { add: ['flexAttributes', 'flexValues'], update: { flexValues: ['value'] } } },
  },
});

export function buildExpectedFlexRoles(baseline = EXPECTED_CLIENT_SESSION_ROLES) {
  equal(baseline, EXPECTED_CLIENT_SESSION_ROLES, 'UNEXPECTED_FLEX_BASELINE');
  const roles = structuredClone(baseline);
  for (const name of ['coach', 'client']) {
    const permissions = FLEX_ROLE_OVERLAY.roles[name].permissions;
    roles[name].permissions.add.push(...permissions.add);
    Object.assign(roles[name].permissions.update, structuredClone(permissions.update));
  }
  return roles;
}
export const EXPECTED_FLEX_ROLES = deepFreeze(buildExpectedFlexRoles());

export function assertFlexManifests(overlay, schema) {
  equal(overlay, FLEX_ROLE_OVERLAY, 'INVALID_FLEX_ROLE_MANIFEST');
  equal(schema, FLEX_SCHEMA, 'INVALID_FLEX_SCHEMA_MANIFEST');
}
function assertExports(schema, roles) {
  if (!record(schema) || !record(schema.schema) || !record(roles) || !record(roles.roles)) {
    fail('INVALID_FLEX_CLOUD_EXPORT');
  }
}

export function planFlexAttributes(overlay, schemaManifest, beforeSchema, beforeRoles) {
  assertFlexManifests(overlay, schemaManifest);
  assertExports(beforeSchema, beforeRoles);
  const schema = {};
  for (const [name, key] of Object.entries(FLEX_SCHEMA.schema)) {
    if (!Object.hasOwn(beforeSchema.schema, name)) schema[name] = key;
    else equal(beforeSchema.schema[name], key, 'INCOMPATIBLE_FLEX_TABLE');
  }
  const roles = {};
  for (const role of ['coach', 'client']) {
    const current = beforeRoles.roles[role];
    if (!isDeepStrictEqual(current, EXPECTED_CLIENT_SESSION_ROLES[role])
      && !isDeepStrictEqual(current, EXPECTED_FLEX_ROLES[role])) {
      fail('UNEXPECTED_FLEX_ROLE_BASELINE');
    }
    if (!isDeepStrictEqual(current, EXPECTED_FLEX_ROLES[role])) {
      roles[role] = structuredClone(EXPECTED_FLEX_ROLES[role]);
    }
  }
  const importPayload = {};
  if (Object.keys(schema).length) importPayload.schema = schema;
  if (Object.keys(roles).length) importPayload.roles = roles;
  return { importPayload, addedTables: Object.keys(schema),
    changedRoles: Object.keys(roles), changeCount: Object.keys(schema).length + Object.keys(roles).length };
}

export function assertFlexUnchanged(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'FLEX_CLOUD_CONFIGURATION_CHANGED');
  equal(currentRoles, beforeRoles, 'FLEX_CLOUD_CONFIGURATION_CHANGED');
}

export function verifyFlexAttributes(overlay, manifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planFlexAttributes(overlay, manifest, beforeSchema, beforeRoles);
  assertExports(afterSchema, afterRoles);
  const expectedSchema = structuredClone(beforeSchema);
  Object.assign(expectedSchema.schema, FLEX_SCHEMA.schema);
  const expectedRoles = structuredClone(beforeRoles);
  for (const role of ['coach', 'client']) expectedRoles.roles[role] = structuredClone(EXPECTED_FLEX_ROLES[role]);
  equal(afterSchema, expectedSchema, 'UNEXPECTED_FLEX_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_FLEX_ROLES_READBACK');
}

export function validateFlexDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_FLEX_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_FLEX_OPERATION)) fail('INVALID_FLEX_OPERATION');
  if (env.DEXIE_FLEX_OPERATION === 'apply') {
    if (env.DEXIE_FLEX_CONFIRMATION !== CONFIRMATION) fail('INVALID_FLEX_CONFIRMATION');
  } else if (env.DEXIE_FLEX_CONFIRMATION) fail('PREVIEW_MUST_NOT_CONFIRM_APPLY');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_FLEX_OPERATOR_COMMAND');
  }
  validateFlexDispatch(process.env);
  if (mode === 'preflight') {
    console.log('Protected manual owner/main Flex Attributes operation authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/flex-attributes-roles.json');
  const manifest = await load('cloud/schema-flex-attributes.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planFlexAttributes(overlay, manifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'flex-import.json'), JSON.stringify(plan.importPayload), { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Approved new Flex tables: ' + (plan.addedTables.join(', ') || 'none'));
    console.log('Approved role extensions: ' + (plan.changedRoles.join(', ') || 'none'));
    return;
  }
  if (env.DEXIE_FLEX_OPERATION !== 'apply') fail('APPLY_REQUIRED');
  if (mode === 'recheck') {
    assertFlexUnchanged(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    equal(await load(join(dir, 'flex-import.json')), plan.importPayload, 'FLEX_IMPORT_PAYLOAD_CHANGED');
    if (!plan.changeCount) fail('NO_FLEX_CHANGES_REQUIRED');
    console.log('Exact schema/roles and payload rechecked immediately before import.');
    return;
  }
  verifyFlexAttributes(overlay, manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')));
  console.log('Exact Flex schema and ACL readback verified; live user authorization still requires manual checks.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'FLEX_CLOUD_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
