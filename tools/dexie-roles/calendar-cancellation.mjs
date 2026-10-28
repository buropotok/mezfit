#!/usr/bin/env node
/** Approved scoped calendar logical-deletion ACL operator; the protected workflow alone invokes cloud import. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ADHOC_SCHEMA } from './adhoc-sessions.mjs';
import { EXPECTED_PLANNED_ROLES } from './planned-sessions.mjs';

export const CONFIRMATION = 'APPLY_CALENDAR_CANCELLATION_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const CANCELLATION_ROLE_OVERLAY = deepFreeze({
  roles: {
    coach: { permissions: { update: { workoutOccurrences: ['inactive'] } } },
    client: { permissions: { update: { workoutOccurrences: ['inactive'] } } },
  },
});

export function buildExpectedCancellationRoles(baseline = EXPECTED_PLANNED_ROLES) {
  equal(baseline, EXPECTED_PLANNED_ROLES, 'UNEXPECTED_PLANNED_BASELINE');
  const roles = structuredClone(baseline);
  for (const name of ['coach', 'client']) roles[name].permissions.update.workoutOccurrences.push('inactive');
  return roles;
}
export const EXPECTED_CANCELLATION_ROLES = deepFreeze(buildExpectedCancellationRoles());

export function assertApprovedManifest(overlay) {
  equal(overlay, CANCELLATION_ROLE_OVERLAY, 'INVALID_CANCELLATION_ROLE_OVERLAY');
}
function assertStructure(schema, roles) {
  if (!record(schema) || !record(schema.schema) || !record(roles) || !record(roles.roles)) {
    fail('INVALID_CLOUD_STRUCTURE');
  }
  // Prerequisites must already exist: this operator never repairs schema.
  for (const name of ['workoutOccurrences', ...Object.keys(ADHOC_SCHEMA.schema)]) {
    equal(schema.schema[name], '@id', 'MISSING_OR_INCOMPATIBLE_SESSION_TABLE');
  }
}

export function planCalendarCancellation(overlay, beforeSchema, beforeRoles) {
  assertApprovedManifest(overlay);
  assertStructure(beforeSchema, beforeRoles);
  const profiles = ['coach', 'client'];
  const baseline = profiles.every(name => isDeepStrictEqual(beforeRoles.roles[name], EXPECTED_PLANNED_ROLES[name]));
  const target = profiles.every(name => isDeepStrictEqual(beforeRoles.roles[name], EXPECTED_CANCELLATION_ROLES[name]));
  if (!baseline && !target) fail('UNEXPECTED_CANCELLATION_ROLE_PROFILE');
  return {
    importPayload: target ? {} : { roles: {
      coach: structuredClone(EXPECTED_CANCELLATION_ROLES.coach),
      client: structuredClone(EXPECTED_CANCELLATION_ROLES.client),
    } },
    changedRoles: target ? [] : profiles,
    changeCount: target ? 0 : 2,
  };
}

export function assertExactImportPayload(expected, actual) {
  equal(actual, expected, 'CANCELLATION_IMPORT_PAYLOAD_CHANGED');
}
export function assertUnchangedBeforeApply(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  equal(currentRoles, beforeRoles, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
}
/** Exact post-attempt verifier, including failed imports and no-op applies; no I/O. */
export function verifyCalendarCancellation(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planCalendarCancellation(overlay, beforeSchema, beforeRoles);
  const expectedRoles = structuredClone(beforeRoles);
  for (const name of ['coach', 'client']) expectedRoles.roles[name] = structuredClone(EXPECTED_CANCELLATION_ROLES[name]);
  equal(afterSchema, beforeSchema, 'UNEXPECTED_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_ROLES_READBACK');
}

export function validateCancellationDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_CANCELLATION_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_CANCELLATION_OPERATION)) fail('INVALID_CANCELLATION_OPERATION');
  if (env.DEXIE_CANCELLATION_OPERATION === 'apply') {
    if (env.DEXIE_CANCELLATION_CONFIRMATION !== CONFIRMATION) fail('INVALID_CANCELLATION_CONFIRMATION');
  } else if (env.DEXIE_CANCELLATION_CONFIRMATION) fail('PREVIEW_MUST_NOT_HAVE_APPLY_CONFIRMATION');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  validateCancellationDispatch(process.env);
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_CANCELLATION_OPERATOR_COMMAND');
  }
  if (mode === 'preflight') {
    console.log('Protected main/owner calendar cancellation ACL dispatch authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/calendar-cancellation-roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planCalendarCancellation(overlay, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'cancellation-proposal.json'), JSON.stringify(plan.importPayload, null, 2),
      { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Approved Coach/Client occurrence update addition: inactive. No physical DELETE grant.');
    console.log('Approved changed roles: ' + (plan.changedRoles.join(', ') || 'none'));
    console.log('No schema, membership, source PLAN, FACT or business data changes.');
    return;
  }
  assertExactImportPayload(plan.importPayload, await load(join(dir, 'cancellation-proposal.json')));
  if (mode === 'recheck') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    console.log('Exact full schema/roles and approved payload rechecked immediately before import.');
    return;
  }
  const afterSchema = await load(join(dir, 'after-schema.json'));
  const afterRoles = await load(join(dir, 'after-roles.json'));
  if (env.DEXIE_CANCELLATION_OPERATION === 'preview') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Preview verified exact complete schema and roles unchanged.');
  } else {
    verifyCalendarCancellation(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Exact calendar logical-deletion ACL and unchanged full schema/other roles verified; no per-user permission test performed.');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'CANCELLATION_CONFIGURATION_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
