#!/usr/bin/env node
/** Protected, exact additive Discussions schema + Coach/Client ACL operator. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EXPECTED_FLEX_ROLES as PREVIOUS_DISCUSSION_ROLES } from './flex-attributes.mjs';
import { addRepeatPermission } from './calendar-repeat.mjs';

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
function extendDiscussionRoles(overlay, baseline = PREVIOUS_DISCUSSION_ROLES) {
  const roles = structuredClone(baseline);
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

// Repeat Apply 41836076736: exact Flex + pendingRepeatRule on both roles.
// Never install this existing grant on a source profile that does not already have it.
const PROFILES = [false, true].flatMap(repeat => {
  const base = repeat ? addRepeatPermission(PREVIOUS_DISCUSSION_ROLES) : PREVIOUS_DISCUSSION_ROLES;
  const suffix = repeat ? '-repeat' : '';
  const target = extendDiscussionRoles(DISCUSSION_ROLE_OVERLAY, base);
  return [
    { name: 'flex' + suffix, roles: base, target },
    { name: 'discussion-text' + suffix, roles: extendDiscussionRoles(LEGACY_DISCUSSION_ROLE_OVERLAY, base), target },
    { name: 'discussion-mvp' + suffix, roles: target, target },
  ];
});
function canonicalRole(role) {
  if (!record(role) || !record(role.permissions)) return null;
  const result = structuredClone(role);
  const permissions = result.permissions;
  const sortedSet = value => Array.isArray(value) && value.every(item => typeof item === 'string')
    && new Set(value).size === value.length ? [...value].sort() : null;
  for (const key of ['add', 'manage']) {
    if (!Object.hasOwn(permissions, key)) continue;
    const sorted = sortedSet(permissions[key]);
    if (!sorted) return null;
    permissions[key] = sorted;
  }
  if (!record(permissions.update)) return null;
  for (const [table, fields] of Object.entries(permissions.update)) {
    const sorted = sortedSet(fields);
    if (!sorted) return null;
    permissions.update[table] = sorted;
  }
  return result;
}
const sameRole = (a, b) => {
  const left = canonicalRole(a), right = canonicalRole(b);
  return left !== null && right !== null && isDeepStrictEqual(left, right);
};
function sameRoles(a, b) {
  if (!record(a) || !record(b) || !record(a.roles) || !record(b.roles)) return false;
  const left = structuredClone(a), right = structuredClone(b);
  for (const name of ['coach', 'client']) {
    if (!sameRole(a.roles[name], b.roles[name])) return false;
    left.roles[name] = canonicalRole(a.roles[name]); right.roles[name] = canonicalRole(b.roles[name]);
  }
  return isDeepStrictEqual(left, right);
}

/** Safe permission-only diagnostics: never serialize arbitrary upstream keys/values or role metadata. */
export function discussionRoleDiagnostics(exported) {
  return ['coach', 'client'].map(name => {
    const baseline = PREVIOUS_DISCUSSION_ROLES[name];
    const role = record(exported?.roles) ? exported.roles[name] : undefined;
    const permissions = record(role?.permissions) ? role.permissions : {};
    const expected = baseline.permissions;
    const knownTables = new Set(PROFILES.flatMap(profile => {
      return ['coach', 'client'].flatMap(user => {
        const p = profile.roles[user].permissions;
        return [...p.add, ...(p.manage ?? []), ...Object.keys(p.update)];
      });
    }));
    const knownField = (table, field) => ['id', 'realmId', 'owner', 'authorUserId', 'threadId'].includes(field)
      || PROFILES.some(profile => ['coach', 'client'].some(user => {
        const updates = profile.roles[user].permissions.update;
        return Object.hasOwn(updates, table) && updates[table].includes(field);
      }));
    const differences = [];
    const compare = (path, actual, wanted, safe, classify) => {
      if (!Array.isArray(actual) || actual.some(value => typeof value !== 'string')) {
        differences.push({ path, problem: 'missing-or-invalid-permission-set', missing: wanted }); return;
      }
      const duplicate = actual.filter((value, index) => actual.indexOf(value) !== index);
      const installedOnly = actual.filter(value => !wanted.includes(value));
      const missing = wanted.filter(value => !actual.includes(value));
      if (installedOnly.length || missing.length || duplicate.length) differences.push({ path,
        installedOnly: installedOnly.map(value => ({ permission: safe(value), classification: classify(value) })),
        missing, duplicates: duplicate.map(safe) });
    };
    for (const key of ['add', 'manage']) {
      if (!Object.hasOwn(expected, key) && !Object.hasOwn(permissions, key)) continue;
      compare('permissions.' + key, permissions[key], expected[key] ?? [],
        table => knownTables.has(table) ? table : '[unknown-table-redacted]',
        table => key === 'add' && DISCUSSION_ROLE_OVERLAY.roles[name].permissions.add.includes(table)
          ? 'approved-discussion' : 'unknown-or-unapproved');
    }
    const updates = record(permissions.update) ? permissions.update : {};
    for (const table of new Set([...Object.keys(expected.update), ...Object.keys(updates)])) {
      const safeTable = knownTables.has(table) ? table : '[unknown-table-redacted]';
      compare('permissions.update.' + safeTable, updates[table], Object.hasOwn(expected.update, table) ? expected.update[table] : [],
        field => knownField(table, field) ? field : '[unknown-field-redacted]',
        field => table === 'workoutOccurrences' && field === 'pendingRepeatRule'
          ? 'approved-existing:calendar-repeat' : table === 'discussionThreads' && field === 'lastActivityAt'
          ? 'approved-discussion' : 'unknown-or-unapproved');
    }
    if (Object.keys(permissions).some(key => !['add', 'manage', 'update'].includes(key)))
      differences.push({ path: 'permissions', problem: 'unknown-permission-key-redacted' });
    const matches = PROFILES.filter(profile => sameRole(role, profile.roles[name])).map(profile => profile.name);
    const metadataKeys = Object.keys(baseline).filter(key => key !== 'permissions');
    const actualKeys = record(role) ? Object.keys(role).filter(key => key !== 'permissions') : [];
    const metadataDifferences = [...new Set([...metadataKeys, ...actualKeys])]
      .filter(key => !record(role) || !isDeepStrictEqual(role[key], baseline[key]))
      .map(key => metadataKeys.includes(key) ? key : '[unknown-metadata-key-redacted]');
    return { role: name, comparedWith: 'flex', matches, differences, metadataDifferences,
      note: matches.length ? 'Role recognized; both roles must match the same complete profile.'
        : 'Unrecognized role. Non-permission metadata values are omitted; unknown identifiers are redacted.' };
  });
}

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
  const profile = PROFILES.find(candidate => ['coach', 'client'].every(role =>
    sameRole(beforeRoles.roles[role], candidate.roles[role])));
  if (!profile) fail('UNEXPECTED_DISCUSSION_ROLE_BASELINE');
  const roles = {};
  for (const role of ['coach', 'client']) {
    const current = beforeRoles.roles[role];
    if (sameRole(current, profile.target[role])) continue;
    // Preserve the validated live row, all unrelated grants, metadata and array order.
    const next = structuredClone(current);
    const grant = DISCUSSION_ROLE_OVERLAY.roles[role].permissions;
    next.permissions.add.push(...grant.add.filter(table => !next.permissions.add.includes(table)));
    if (!Object.hasOwn(next.permissions.update, 'discussionThreads'))
      next.permissions.update.discussionThreads = [...grant.update.discussionThreads];
    roles[role] = next;
  }
  const importPayload = {};
  if (Object.keys(schema).length) importPayload.schema = schema;
  if (Object.keys(roles).length) importPayload.roles = roles;
  return { importPayload, sourceProfile: profile.name, addedTables: Object.keys(schema),
    changedRoles: Object.keys(roles), changeCount: Object.keys(schema).length + Object.keys(roles).length };
}

export function assertDiscussionUnchanged(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'DISCUSSION_CLOUD_CONFIGURATION_CHANGED');
  if (!sameRoles(currentRoles, beforeRoles)) fail('DISCUSSION_CLOUD_CONFIGURATION_CHANGED');
}

export function verifyDiscussions(overlay, manifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  const plan = planDiscussions(overlay, manifest, beforeSchema, beforeRoles);
  assertExports(afterSchema, afterRoles);
  const expectedSchema = structuredClone(beforeSchema);
  Object.assign(expectedSchema.schema, DISCUSSION_SCHEMA.schema);
  const expectedRoles = structuredClone(beforeRoles);
  Object.assign(expectedRoles.roles, plan.importPayload.roles ?? {});
  equal(afterSchema, expectedSchema, 'UNEXPECTED_DISCUSSION_SCHEMA_READBACK');
  if (!sameRoles(afterRoles, expectedRoles)) fail('UNEXPECTED_DISCUSSION_ROLES_READBACK');
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
  let plan;
  try {
    plan = planDiscussions(overlay, manifest, beforeSchema, beforeRoles);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNEXPECTED_DISCUSSION_ROLE_BASELINE')
      console.error(JSON.stringify({ code: error.message, roles: discussionRoleDiagnostics(beforeRoles) }));
    throw error;
  }
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
