#!/usr/bin/env node
/** Protected, exact additive Discussions schema + Coach/Client ACL operator. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EXPECTED_FLEX_ROLES as PREVIOUS_DISCUSSION_ROLES } from './flex-attributes.mjs';

export const CONFIRMATION = 'APPLY_DISCUSSIONS_SCHEMA_AND_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const DISCUSSION_SCHEMA = deepFreeze({ schema: { discussionThreads: 'id', discussionMessages: 'id', discussionReadStates: 'id', messageAttachments: 'id' } });
export const LEGACY_DISCUSSION_ROLE_OVERLAY = deepFreeze({
  roles: {
    coach: { permissions: { add: ['discussionThreads', 'discussionMessages', 'discussionReadStates'], update: { discussionThreads: ['lastActivityAt'] } } },
    client: { permissions: { add: ['discussionThreads', 'discussionMessages', 'discussionReadStates'], update: { discussionThreads: ['lastActivityAt'] } } },
  },
});

// Frozen PR #653 profile: accept only its complete exact policy when upgrading.
export const DISCUSSION_ROLE_OVERLAY = deepFreeze({
  roles: {
    coach: { permissions: { add: ['discussionThreads', 'discussionMessages', 'discussionReadStates', 'messageAttachments'], update: { discussionThreads: ['lastActivityAt'] } } },
    client: { permissions: { add: ['discussionThreads', 'discussionMessages', 'discussionReadStates', 'messageAttachments'], update: { discussionThreads: ['lastActivityAt'] } } },
  },
});
function extendDiscussionRoles(overlay) {
  const roles = structuredClone(PREVIOUS_DISCUSSION_ROLES);
  for (const name of ['coach', 'client']) {
    const permissions = overlay.roles[name].permissions;
    roles[name].permissions.add.push(...permissions.add);
    Object.assign(roles[name].permissions.update, structuredClone(permissions.update));
  }
  return roles;
}
export const LEGACY_DISCUSSION_ROLES = deepFreeze(extendDiscussionRoles(LEGACY_DISCUSSION_ROLE_OVERLAY));
export function buildExpectedDiscussionRoles(baseline = PREVIOUS_DISCUSSION_ROLES) {
  equal(baseline, PREVIOUS_DISCUSSION_ROLES, 'UNEXPECTED_DISCUSSION_BASELINE');
  return extendDiscussionRoles(DISCUSSION_ROLE_OVERLAY);
}
export const EXPECTED_DISCUSSION_ROLES = deepFreeze(buildExpectedDiscussionRoles());

export function assertDiscussionManifests(overlay, schema) {
  equal(overlay, DISCUSSION_ROLE_OVERLAY, 'INVALID_DISCUSSION_ROLE_MANIFEST');
  equal(schema, DISCUSSION_SCHEMA, 'INVALID_DISCUSSION_SCHEMA_MANIFEST');
}
function assertExports(schema, roles) {
  if (!record(schema) || !record(schema.schema) || !record(roles) || !record(roles.roles)) {
    fail('INVALID_DISCUSSION_CLOUD_EXPORT');
  }
}

export function planDiscussions(overlay, schemaManifest, beforeSchema, beforeRoles) {
  assertDiscussionManifests(overlay, schemaManifest);
  assertExports(beforeSchema, beforeRoles);
  const schema = {};
  for (const [name, key] of Object.entries(DISCUSSION_SCHEMA.schema)) {
    if (!Object.hasOwn(beforeSchema.schema, name)) schema[name] = key;
    else equal(beforeSchema.schema[name], key, 'INCOMPATIBLE_DISCUSSION_TABLE');
  }
  const allPrevious = ['coach', 'client'].every(role => isDeepStrictEqual(beforeRoles.roles[role], PREVIOUS_DISCUSSION_ROLES[role]));
  const allLegacy = ['coach', 'client'].every(role => isDeepStrictEqual(beforeRoles.roles[role], LEGACY_DISCUSSION_ROLES[role]));
  const allTarget = ['coach', 'client'].every(role => isDeepStrictEqual(beforeRoles.roles[role], EXPECTED_DISCUSSION_ROLES[role]));
  if (!allPrevious && !allLegacy && !allTarget) fail('UNEXPECTED_DISCUSSION_ROLE_BASELINE');
  const roles = {};
  for (const role of ['coach', 'client']) {
    const current = beforeRoles.roles[role];
    if (!isDeepStrictEqual(current, PREVIOUS_DISCUSSION_ROLES[role])
      && !isDeepStrictEqual(current, LEGACY_DISCUSSION_ROLES[role])
      && !isDeepStrictEqual(current, EXPECTED_DISCUSSION_ROLES[role])) {
      fail('UNEXPECTED_DISCUSSION_ROLE_BASELINE');
    }
    if (!isDeepStrictEqual(current, EXPECTED_DISCUSSION_ROLES[role])) {
      roles[role] = structuredClone(EXPECTED_DISCUSSION_ROLES[role]);
    }
  }
  const importPayload = {};
  if (Object.keys(schema).length) importPayload.schema = schema;
  if (Object.keys(roles).length) importPayload.roles = roles;
  return { importPayload, sourceProfile: allPrevious ? 'flex' : allLegacy ? 'discussion-text' : 'discussion-mvp', addedTables: Object.keys(schema),
    changedRoles: Object.keys(roles), changeCount: Object.keys(schema).length + Object.keys(roles).length };
}

export function assertDiscussionUnchanged(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'DISCUSSION_CLOUD_CONFIGURATION_CHANGED');
  equal(currentRoles, beforeRoles, 'DISCUSSION_CLOUD_CONFIGURATION_CHANGED');
}

export function verifyDiscussions(overlay, manifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planDiscussions(overlay, manifest, beforeSchema, beforeRoles);
  assertExports(afterSchema, afterRoles);
  const expectedSchema = structuredClone(beforeSchema);
  Object.assign(expectedSchema.schema, DISCUSSION_SCHEMA.schema);
  const expectedRoles = structuredClone(beforeRoles);
  for (const role of ['coach', 'client']) expectedRoles.roles[role] = structuredClone(EXPECTED_DISCUSSION_ROLES[role]);
  equal(afterSchema, expectedSchema, 'UNEXPECTED_DISCUSSION_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_DISCUSSION_ROLES_READBACK');
}

export function validateDiscussionDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_DISCUSSION_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_DISCUSSION_OPERATION)) fail('INVALID_DISCUSSION_OPERATION');
  if (env.DEXIE_DISCUSSION_OPERATION === 'apply') {
    if (env.DEXIE_DISCUSSION_COMM02_VALIDATED !== 'true') fail('COMM02_VALIDATION_REQUIRED');
    if (env.DEXIE_DISCUSSION_CONFIRMATION !== CONFIRMATION) fail('INVALID_DISCUSSION_CONFIRMATION');
  } else if (env.DEXIE_DISCUSSION_CONFIRMATION) fail('PREVIEW_MUST_NOT_CONFIRM_APPLY');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_DISCUSSION_OPERATOR_COMMAND');
  }
  validateDiscussionDispatch(process.env);
  if (mode === 'preflight') {
    console.log('Protected manual owner/main Discussions operation authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/discussion-roles.json');
  const manifest = await load('cloud/schema-discussions.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planDiscussions(overlay, manifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'discussions-import.json'), JSON.stringify(plan.importPayload), { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Verified source profile: ' + plan.sourceProfile);
    console.log('Approved new Discussion tables: ' + (plan.addedTables.join(', ') || 'none'));
    console.log('Approved role extensions: ' + (plan.changedRoles.join(', ') || 'none'));
    return;
  }
  if (env.DEXIE_DISCUSSION_OPERATION !== 'apply') fail('APPLY_REQUIRED');
  if (mode === 'recheck') {
    assertDiscussionUnchanged(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    equal(await load(join(dir, 'discussions-import.json')), plan.importPayload, 'DISCUSSION_IMPORT_PAYLOAD_CHANGED');
    if (!plan.changeCount) fail('NO_DISCUSSION_CHANGES_REQUIRED');
    console.log('Exact schema/roles and payload rechecked immediately before import.');
    return;
  }
  verifyDiscussions(overlay, manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')));
  console.log('Exact Discussion schema and ACL readback verified; live user authorization still requires manual checks.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'DISCUSSION_CLOUD_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
