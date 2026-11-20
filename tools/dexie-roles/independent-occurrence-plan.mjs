#!/usr/bin/env node
/** Protected exact Client-only occurrence PLAN ACL extension. No source program or Coach grants. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EXPECTED_DISCUSSION_ROLES } from './discussions.mjs';
import { addRepeatPermission } from './calendar-repeat.mjs';

export const CONFIRMATION = 'APPLY_INDEPENDENT_OCCURRENCE_PLAN_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const FIELDS = ['plan', 'publishedPlan'];
const fail = reason => { throw Error(reason); };
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b, reason) => { if (!isDeepStrictEqual(a, b)) fail(reason); };
export const OVERLAY = Object.freeze({ roles: {
  client: { permissions: { update: { workoutOccurrences: FIELDS } } },
} });

/** The complete approved Discussions MVP is the only supported base, with or without its existing repeat grant. */
const BASES = [EXPECTED_DISCUSSION_ROLES, addRepeatPermission(EXPECTED_DISCUSSION_ROLES)];
export function extendIndependentPlanAccess(baseline) {
  const next = copy(baseline);
  const updates = next.client?.permissions?.update?.workoutOccurrences;
  if (!Array.isArray(updates) || FIELDS.some(field => updates.includes(field)))
    fail('INVALID_INDEPENDENT_PLAN_BASELINE');
  updates.push(...FIELDS);
  return next;
}
function canonicalRole(role) {
  if (!object(role) || !object(role.permissions) || !object(role.permissions.update)) return null;
  const canonical = copy(role);
  const uniqueSorted = value => Array.isArray(value) && value.every(item => typeof item === 'string')
    && value.length === new Set(value).size ? [...value].sort() : null;
  for (const section of ['add', 'manage']) {
    if (!Object.hasOwn(canonical.permissions, section)) continue;
    const sorted = uniqueSorted(canonical.permissions[section]);
    if (!sorted) return null;
    canonical.permissions[section] = sorted;
  }
  for (const [table, fields] of Object.entries(canonical.permissions.update)) {
    const sorted = uniqueSorted(fields);
    if (!sorted) return null;
    canonical.permissions.update[table] = sorted;
  }
  return canonical;
}
const sameRole = (a, b) => {
  const left = canonicalRole(a), right = canonicalRole(b);
  return left !== null && right !== null && isDeepStrictEqual(left, right);
};
function sameExport(a, b) {
  if (!object(a) || !object(b) || !object(a.roles) || !object(b.roles)) return false;
  const left = copy(a), right = copy(b);
  for (const role of ['coach', 'client']) {
    if (!sameRole(a.roles[role], b.roles[role])) return false;
    left.roles[role] = canonicalRole(a.roles[role]);
    right.roles[role] = canonicalRole(b.roles[role]);
  }
  return isDeepStrictEqual(left, right);
}
export function planIndependentOccurrencePlan(manifest, schema, before) {
  equal(manifest, OVERLAY, 'INVALID_INDEPENDENT_PLAN_MANIFEST');
  if (!object(schema) || !object(schema.schema) || schema.schema.workoutOccurrences !== '@id'
    || !object(before) || !object(before.roles)) fail('INVALID_INDEPENDENT_PLAN_CLOUD_EXPORT');
  const base = BASES.find(profile => {
    const upgraded = extendIndependentPlanAccess(profile);
    return sameRole(before.roles.coach, profile.coach)
      && (sameRole(before.roles.client, profile.client) || sameRole(before.roles.client, upgraded.client));
  });
  if (!base) fail('UNEXPECTED_INDEPENDENT_PLAN_ROLE_BASELINE');
  const expected = extendIndependentPlanAccess(base);
  if (sameRole(before.roles.client, expected.client))
    return { changed: false, payload: {} };
  const next = copy(before.roles.client);
  next.permissions.update.workoutOccurrences.push(...FIELDS);
  return { changed: true, payload: { roles: { client: next } } };
}
export function verifyIndependentOccurrencePlan(manifest, beforeSchema, beforeRoles,
  afterSchema, afterRoles, applied) {
  const planned = planIndependentOccurrencePlan(manifest, beforeSchema, beforeRoles);
  const expected = copy(beforeRoles);
  if (applied && planned.changed) expected.roles.client = planned.payload.roles.client;
  equal(afterSchema, beforeSchema, 'UNEXPECTED_INDEPENDENT_PLAN_SCHEMA_CHANGE');
  if (!sameExport(afterRoles, expected)) fail('UNEXPECTED_INDEPENDENT_PLAN_ROLE_CHANGE');
}
export function validateDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER)
    fail('UNAUTHORIZED_INDEPENDENT_PLAN_DISPATCH');
  if (!['preview', 'apply'].includes(env.INDEPENDENT_PLAN_OPERATION))
    fail('INVALID_INDEPENDENT_PLAN_OPERATION');
  if (env.INDEPENDENT_PLAN_OPERATION === 'apply') {
    if (env.INDEPENDENT_PLAN_CONFIRMATION !== CONFIRMATION) fail('INVALID_INDEPENDENT_PLAN_CONFIRMATION');
  } else if (env.INDEPENDENT_PLAN_CONFIRMATION) fail('PREVIEW_CANNOT_CONFIRM_APPLY');
}
const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode))
    fail('INVALID_INDEPENDENT_PLAN_COMMAND');
  validateDispatch(process.env);
  if (mode === 'preflight') return;
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_INDEPENDENT_PLAN_DB');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT)
    fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const manifest = await load('cloud/independent-occurrence-plan-roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const planned = planIndependentOccurrencePlan(manifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'independent-plan-import.json'), JSON.stringify(planned.payload), { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + Number(planned.changed) + '\n');
    console.log(planned.changed ? 'Client occurrence PLAN field update prepared' : 'Client occurrence PLAN ACL already installed');
    return;
  }
  equal(await load(join(dir, 'independent-plan-import.json')), planned.payload, 'INDEPENDENT_PLAN_PAYLOAD_CHANGED');
  if (mode === 'recheck') {
    if (env.INDEPENDENT_PLAN_OPERATION !== 'apply' || !planned.changed) fail('INDEPENDENT_PLAN_APPLY_NOT_REQUIRED');
    equal(await load(join(dir, 'current-schema.json')), beforeSchema, 'INDEPENDENT_PLAN_CONFIGURATION_DRIFT');
    if (!sameExport(await load(join(dir, 'current-roles.json')), beforeRoles))
      fail('INDEPENDENT_PLAN_CONFIGURATION_DRIFT');
    return;
  }
  verifyIndependentOccurrencePlan(manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')),
    env.INDEPENDENT_PLAN_OPERATION === 'apply');
  console.log('Verified complete schema and roles readback; live Client/Coach testing remains required.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'INDEPENDENT_PLAN_ACL_FAILED');
    process.exitCode = 1;
  });
}
