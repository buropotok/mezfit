#!/usr/bin/env node
/** Exact Coach/Client field-only ACL extension; invoked only by protected workflow. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EXPECTED_CALENDAR_ROLES, EXPECTED_ADHOC_ROLES } from './adhoc-sessions.mjs';
import { EXPECTED_PLANNED_ROLES } from './planned-sessions.mjs';
import { EXPECTED_CANCELLATION_ROLES } from './calendar-cancellation.mjs';
import { EXPECTED_CLIENT_SESSION_ROLES } from './client-sessions.mjs';
import { EXPECTED_COACHED_START_ROLES } from './coached-start.mjs';
import { EXPECTED_FLEX_ROLES } from './flex-attributes.mjs';

const FIELD = 'pendingRepeatRule';
export const CONFIRMATION = 'APPLY_CALENDAR_REPEAT_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const USERS = ['coach', 'client'];
const PROFILES = [EXPECTED_CALENDAR_ROLES, EXPECTED_ADHOC_ROLES,
  EXPECTED_PLANNED_ROLES, EXPECTED_CANCELLATION_ROLES,
  EXPECTED_CLIENT_SESSION_ROLES, EXPECTED_COACHED_START_ROLES, EXPECTED_FLEX_ROLES];
const equal = (a, b, reason) => { if (!isDeepStrictEqual(a, b)) throw Error(reason); };
const fail = reason => { throw Error(reason); };
const object = a => a !== null && typeof a === 'object' && !Array.isArray(a);
const copy = a => structuredClone(a);
export const OVERLAY = Object.freeze({ roles: {
  coach: { permissions: { update: { workoutOccurrences: [FIELD] } } },
  client: { permissions: { update: { workoutOccurrences: [FIELD] } } },
} });
export function addRepeatPermission(profile) {
  const result = copy(profile);
  for (const user of USERS) {
    const fields = result[user].permissions.update.workoutOccurrences;
    if (!Array.isArray(fields) || fields.includes(FIELD)) fail('INVALID_REPEAT_BASELINE');
    fields.push(FIELD);
  }
  return result;
}
export function planRepeatAcl(manifest, schema, roles) {
  equal(manifest, OVERLAY, 'INVALID_REPEAT_MANIFEST');
  if (!object(schema) || !object(schema.schema) || schema.schema.workoutOccurrences !== '@id'
    || !object(roles) || !object(roles.roles)) fail('INVALID_REPEAT_CLOUD_EXPORT');
  for (const baseline of PROFILES) {
    const target = addRepeatPermission(baseline);
    if (!USERS.every(user => isDeepStrictEqual(roles.roles[user], baseline[user])
      || isDeepStrictEqual(roles.roles[user], target[user]))) continue;
    const changed = USERS.filter(user => !isDeepStrictEqual(roles.roles[user], target[user]));
    return { changed, payload: changed.length ? { roles: Object.fromEntries(
      changed.map(user => [user, target[user]])) } : {} };
  }
  fail('UNEXPECTED_REPEAT_ACL_BASELINE');
}
export function verifyRepeatAcl(manifest, beforeSchema, beforeRoles, afterSchema, afterRoles, apply) {
  const { payload } = planRepeatAcl(manifest, beforeSchema, beforeRoles);
  const expected = copy(beforeRoles);
  if (apply) Object.assign(expected.roles, payload.roles ?? {});
  equal(afterSchema, beforeSchema, 'UNEXPECTED_REPEAT_SCHEMA_CHANGE');
  equal(afterRoles, expected, 'UNEXPECTED_REPEAT_ROLES_CHANGE');
}
export function validateDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER)
    fail('UNAUTHORIZED_REPEAT_DISPATCH');
  if (!['preview', 'apply'].includes(env.REPEAT_OPERATION)) fail('INVALID_REPEAT_OPERATION');
  if (env.REPEAT_OPERATION === 'apply') {
    if (env.REPEAT_CONFIRMATION !== CONFIRMATION) fail('INVALID_REPEAT_CONFIRMATION');
  } else if (env.REPEAT_CONFIRMATION) fail('PREVIEW_CANNOT_CONFIRM_APPLY');
}
const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode))
    fail('INVALID_REPEAT_COMMAND');
  validateDispatch(process.env);
  if (mode === 'preflight') return;
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_REPEAT_DB');
  const e = process.env;
  if (!e.RUNNER_TEMP || !e.GITHUB_RUN_ID || !e.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(e.RUNNER_TEMP, 'dexie-schema-' + e.GITHUB_RUN_ID + '-' + e.GITHUB_RUN_ATTEMPT);
  const manifest = await load('cloud/calendar-repeat-roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const planned = planRepeatAcl(manifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!e.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'repeat-import.json'), JSON.stringify(planned.payload), { flag: 'wx', mode: 0o600 });
    await appendFile(e.GITHUB_OUTPUT, 'change_count=' + planned.changed.length + '\n');
    console.log('Exact repeat-rule field-only change for: ' + (planned.changed.join(',') || 'none'));
    return;
  }
  equal(await load(join(dir, 'repeat-import.json')), planned.payload, 'REPEAT_PAYLOAD_CHANGED');
  if (mode === 'recheck') {
    if (e.REPEAT_OPERATION !== 'apply' || !planned.changed.length) fail('REPEAT_APPLY_NOT_REQUIRED');
    equal(await load(join(dir, 'current-schema.json')), beforeSchema, 'REPEAT_CONFIGURATION_DRIFT');
    equal(await load(join(dir, 'current-roles.json')), beforeRoles, 'REPEAT_CONFIGURATION_DRIFT');
    return;
  }
  verifyRepeatAcl(manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')),
    e.REPEAT_OPERATION === 'apply');
  console.log('Verified full schema and role readback; live-user ACL test still required.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'REPEAT_ACL_FAILED');
    process.exitCode = 1;
  });
}
