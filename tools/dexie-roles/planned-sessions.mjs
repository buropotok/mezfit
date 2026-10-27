#!/usr/bin/env node
/** Approved scoped Coach ACL operator; the protected workflow alone invokes cloud import. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ADHOC_SCHEMA, EXPECTED_ADHOC_ROLES } from './adhoc-sessions.mjs';

export const CONFIRMATION = 'APPLY_PLANNED_SESSION_COACH_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const PLANNED_ROLE_OVERLAY = deepFreeze({
  roles: { coach: { permissions: { update: { workoutOccurrences: ['status', 'workoutSessionId'] } } } },
});

export function buildExpectedPlannedRoles(baseline = EXPECTED_ADHOC_ROLES) {
  equal(baseline, EXPECTED_ADHOC_ROLES, 'UNEXPECTED_ADHOC_BASELINE');
  const roles = structuredClone(baseline);
  roles.coach.permissions.update.workoutOccurrences.push(
    ...PLANNED_ROLE_OVERLAY.roles.coach.permissions.update.workoutOccurrences);
  return roles;
}
export const EXPECTED_PLANNED_ROLES = deepFreeze(buildExpectedPlannedRoles());

export function assertApprovedManifest(overlay) {
  equal(overlay, PLANNED_ROLE_OVERLAY, 'INVALID_PLANNED_ROLE_OVERLAY');
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

export function planPlannedSessions(overlay, beforeSchema, beforeRoles) {
  assertApprovedManifest(overlay);
  assertStructure(beforeSchema, beforeRoles);
  equal(beforeRoles.roles.client, EXPECTED_ADHOC_ROLES.client, 'UNEXPECTED_CLIENT_ROLE');
  const coach = beforeRoles.roles.coach;
  if (!isDeepStrictEqual(coach, EXPECTED_ADHOC_ROLES.coach)
    && !isDeepStrictEqual(coach, EXPECTED_PLANNED_ROLES.coach)) fail('UNEXPECTED_COACH_ROLE');
  const changed = !isDeepStrictEqual(coach, EXPECTED_PLANNED_ROLES.coach);
  return {
    importPayload: changed ? { roles: { coach: structuredClone(EXPECTED_PLANNED_ROLES.coach) } } : {},
    changedRoles: changed ? ['coach'] : [],
    changeCount: changed ? 1 : 0,
  };
}

export function assertExactImportPayload(expected, actual) {
  equal(actual, expected, 'PLANNED_IMPORT_PAYLOAD_CHANGED');
}
export function assertUnchangedBeforeApply(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  equal(currentRoles, beforeRoles, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
}
/** Exact post-attempt verifier, including failed imports and no-op applies; no I/O. */
export function verifyPlannedSessions(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planPlannedSessions(overlay, beforeSchema, beforeRoles);
  const expectedRoles = structuredClone(beforeRoles);
  expectedRoles.roles.coach = structuredClone(EXPECTED_PLANNED_ROLES.coach);
  equal(afterSchema, beforeSchema, 'UNEXPECTED_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_ROLES_READBACK');
}

export function validatePlannedDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_PLANNED_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_PLANNED_OPERATION)) fail('INVALID_PLANNED_OPERATION');
  if (env.DEXIE_PLANNED_OPERATION === 'apply') {
    if (env.DEXIE_PLANNED_CONFIRMATION !== CONFIRMATION) fail('INVALID_PLANNED_CONFIRMATION');
  } else if (env.DEXIE_PLANNED_CONFIRMATION) fail('PREVIEW_MUST_NOT_HAVE_APPLY_CONFIRMATION');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  validatePlannedDispatch(process.env);
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_PLANNED_OPERATOR_COMMAND');
  }
  if (mode === 'preflight') {
    console.log('Protected main/owner planned session ACL dispatch authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/planned-session-roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planPlannedSessions(overlay, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'planned-proposal.json'), JSON.stringify(plan.importPayload, null, 2),
      { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Approved Coach occurrence update additions: status, workoutSessionId.');
    console.log('Approved changed roles: ' + (plan.changedRoles.join(', ') || 'none'));
    console.log('No schema, membership or business data changes.');
    return;
  }
  assertExactImportPayload(plan.importPayload, await load(join(dir, 'planned-proposal.json')));
  if (mode === 'recheck') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    console.log('Exact full schema/roles and approved payload rechecked immediately before import.');
    return;
  }
  const afterSchema = await load(join(dir, 'after-schema.json'));
  const afterRoles = await load(join(dir, 'after-roles.json'));
  if (env.DEXIE_PLANNED_OPERATION === 'preview') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Preview verified exact complete schema and roles unchanged.');
  } else {
    verifyPlannedSessions(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Exact Coach ACL and unchanged full schema/other roles verified; no per-user permission test performed.');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'PLANNED_CONFIGURATION_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
