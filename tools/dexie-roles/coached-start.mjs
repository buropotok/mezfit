#!/usr/bin/env node
/** Approved scoped Coach coached-start format ACL operator; the protected workflow alone invokes cloud import. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ADHOC_SCHEMA } from './adhoc-sessions.mjs';
import { EXPECTED_CLIENT_SESSION_ROLES } from './client-sessions.mjs';

export const CONFIRMATION = 'APPLY_COACHED_START_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const COACHED_START_ROLE_OVERLAY = deepFreeze({
  roles: { coach: { permissions: { update: { workoutOccurrences: ['format'] } } } },
});
export function buildExpectedCoachedStartRoles(baseline = EXPECTED_CLIENT_SESSION_ROLES) {
  equal(baseline, EXPECTED_CLIENT_SESSION_ROLES, 'UNEXPECTED_CLIENT_SESSION_BASELINE');
  const roles = structuredClone(baseline);
  roles.coach.permissions.update.workoutOccurrences.push(...COACHED_START_ROLE_OVERLAY.roles.coach.permissions.update.workoutOccurrences);
  return roles;
}
export const EXPECTED_COACHED_START_ROLES = deepFreeze(buildExpectedCoachedStartRoles());

export function assertApprovedManifest(overlay) {
  equal(overlay, COACHED_START_ROLE_OVERLAY, 'INVALID_COACHED_START_ROLE_OVERLAY');
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

export function planCoachedStart(overlay, beforeSchema, beforeRoles) {
  assertApprovedManifest(overlay);
  assertStructure(beforeSchema, beforeRoles);
  const profiles = ['coach', 'client'];
  const baseline = profiles.every(name => isDeepStrictEqual(beforeRoles.roles[name], EXPECTED_CLIENT_SESSION_ROLES[name]));
  const target = profiles.every(name => isDeepStrictEqual(beforeRoles.roles[name], EXPECTED_COACHED_START_ROLES[name]));
  if (!baseline && !target) fail('UNEXPECTED_COACHED_START_ROLE_PROFILE');
  return {
    importPayload: target ? {} : { roles: {
      coach: structuredClone(EXPECTED_COACHED_START_ROLES.coach),
    } },
    changedRoles: target ? [] : ['coach'],
    changeCount: target ? 0 : 1,
  };
}

export function assertExactImportPayload(expected, actual) {
  equal(actual, expected, 'COACHED_START_IMPORT_PAYLOAD_CHANGED');
}
export function assertUnchangedBeforeApply(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  equal(currentRoles, beforeRoles, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
}
/** Exact post-attempt verifier, including failed imports and no-op applies; no I/O. */
export function verifyCoachedStart(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planCoachedStart(overlay, beforeSchema, beforeRoles);
  const expectedRoles = structuredClone(beforeRoles);
  expectedRoles.roles.coach = structuredClone(EXPECTED_COACHED_START_ROLES.coach);
  equal(afterSchema, beforeSchema, 'UNEXPECTED_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_ROLES_READBACK');
}

export function validateCoachedStartDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_COACHED_START_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_COACHED_START_OPERATION)) fail('INVALID_COACHED_START_OPERATION');
  if (env.DEXIE_COACHED_START_OPERATION === 'apply') {
    if (env.DEXIE_COACHED_START_CONFIRMATION !== CONFIRMATION) fail('INVALID_COACHED_START_CONFIRMATION');
  } else if (env.DEXIE_COACHED_START_CONFIRMATION) fail('PREVIEW_MUST_NOT_HAVE_APPLY_CONFIRMATION');
}

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  validateCoachedStartDispatch(process.env);
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_COACHED_START_OPERATOR_COMMAND');
  }
  if (mode === 'preflight') {
    console.log('Protected main/owner Coach format ACL dispatch authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/coached-start-roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planCoachedStart(overlay, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'coached-start-proposal.json'), JSON.stringify(plan.importPayload, null, 2),
      { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Approved Coach workoutOccurrences.format update only. No DELETE/manage grant.');
    console.log('Approved changed roles: ' + (plan.changedRoles.join(', ') || 'none'));
    console.log('No schema, membership, source PLAN, existing scheduled FACT or business data changes.');
    return;
  }
  assertExactImportPayload(plan.importPayload, await load(join(dir, 'coached-start-proposal.json')));
  if (mode === 'recheck') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    console.log('Exact full schema/roles and approved payload rechecked immediately before import.');
    return;
  }
  const afterSchema = await load(join(dir, 'after-schema.json'));
  const afterRoles = await load(join(dir, 'after-roles.json'));
  if (env.DEXIE_COACHED_START_OPERATION === 'preview') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Preview verified exact complete schema and roles unchanged.');
  } else {
    verifyCoachedStart(overlay, beforeSchema, beforeRoles, afterSchema, afterRoles);
    console.log('Exact Coach coached-start format ACL and unchanged full schema/other roles verified; no per-user permission test performed.');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'COACHED_START_CONFIGURATION_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
