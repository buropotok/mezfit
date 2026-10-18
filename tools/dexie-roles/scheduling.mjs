#!/usr/bin/env node
/**
 * Exact, single-purpose global Coach/Client role rollout.
 * Cloud writes are possible only from the protected manual workflow after merge.
 * The schema CLI owns ephemeral credential preparation; this script never reads secrets.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const DB_URL = 'https://zjv60oxag.dexie.cloud';
const CONFIRMATION = 'APPLY_SCHEDULING_COACH_CLIENT_ACL';
const ROLES = ['coach', 'client'];
const PLAN_TABLES = ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets'];
const FACT_FIELDS = [
  'actualReps', 'actualWeightKg', 'actualDurationSeconds', 'actualDistanceMeters',
  'setLabel', 'rpe', 'comment', 'bands', 'setStatus',
];
const DESCRIPTIONS = {
  coach: {
    before: 'Can author assigned PLAN and edit set FACT; session lifecycle stays privileged',
    after: 'Can author assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged',
  },
  client: {
    before: 'Can read assigned PLAN and edit only set FACT; session lifecycle stays privileged',
    after: 'Can read assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged',
  },
};

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(code) { throw new Error(code); }

function expectedRole(name, withScheduling) {
  return {
    displayName: name === 'coach' ? 'Coach' : 'Client',
    description: DESCRIPTIONS[name][withScheduling ? 'after' : 'before'],
    sortOrder: name === 'coach' ? 1 : 2,
    permissions: {
      ...(withScheduling ? { add: ['workoutScheduleRequests'] } : {}),
      ...(name === 'coach' ? { manage: PLAN_TABLES } : {}),
      update: { sessionSetFacts: FACT_FIELDS },
    },
  };
}

/** Refuse a changed committed manifest, even if someone changes the JSON and its tests. */
export function assertApprovedManifest(manifest) {
  if (!record(manifest) || !record(manifest.roles)
    || !isDeepStrictEqual(Object.keys(manifest), ['roles'])
    || !isDeepStrictEqual(Object.keys(manifest.roles).sort(), [...ROLES].sort())) {
    fail('INVALID_SCHEDULING_ROLE_MANIFEST');
  }
  for (const name of ROLES) {
    if (!isDeepStrictEqual(manifest.roles[name], expectedRole(name, true))) {
      fail('INVALID_SCHEDULING_ROLE_MANIFEST');
    }
  }
  return manifest.roles;
}

function assertCloudStructure(schema, exportedRoles) {
  if (!record(schema) || !record(schema.schema)
    || schema.schema.workoutScheduleRequests !== 'id'
    || !record(exportedRoles) || !record(exportedRoles.roles)) {
    fail('INVALID_SCHEDULING_CLOUD_STRUCTURE');
  }
}

export function planSchedulingAcl(manifest, schema, exportedRoles) {
  const desired = assertApprovedManifest(manifest);
  assertCloudStructure(schema, exportedRoles);
  const updates = {};
  for (const name of ROLES) {
    const actual = exportedRoles.roles[name];
    if (isDeepStrictEqual(actual, desired[name])) continue;
    if (!isDeepStrictEqual(actual, expectedRole(name, false))) {
      fail('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
    }
    updates[name] = desired[name];
  }
  return {
    importPayload: { roles: updates },
    changedNames: Object.keys(updates),
  };
}

export function assertUnchangedBeforeApply(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  if (!isDeepStrictEqual(beforeSchema, currentSchema)
    || !isDeepStrictEqual(beforeRoles, currentRoles)) {
    fail('CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  }
}

export function verifySchedulingAcl(manifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  const desired = assertApprovedManifest(manifest);
  assertCloudStructure(beforeSchema, beforeRoles);
  assertCloudStructure(afterSchema, afterRoles);
  // No schema/seal mutation and no changes to other global roles.
  if (!isDeepStrictEqual(beforeSchema, afterSchema)
    || !isDeepStrictEqual(Object.keys(beforeRoles.roles).sort(), Object.keys(afterRoles.roles).sort())) {
    fail('UNEXPECTED_CLOUD_CONFIGURATION_CHANGE');
  }
  for (const [name, beforeRole] of Object.entries(beforeRoles.roles)) {
    if (ROLES.includes(name)) {
      if (!isDeepStrictEqual(afterRoles.roles[name], desired[name])) fail('SCHEDULING_ROLE_NOT_APPLIED');
    } else if (!isDeepStrictEqual(afterRoles.roles[name], beforeRole)) {
      fail('UNRELATED_CLOUD_ROLE_CHANGED');
    }
  }
}

export function validateAclDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_ACL_WORKFLOW_DISPATCH');
  }
  if (env.DEXIE_ACL_OPERATION !== 'preview' && env.DEXIE_ACL_OPERATION !== 'apply') {
    fail('INVALID_ACL_OPERATION');
  }
  if (env.DEXIE_ACL_OPERATION === 'apply') {
    if (env.DEXIE_ACL_CONFIRMATION !== CONFIRMATION) fail('INVALID_ACL_CONFIRMATION');
  } else if (env.DEXIE_ACL_CONFIRMATION) {
    fail('PREVIEW_MUST_NOT_HAVE_APPLY_CONFIRMATION');
  }
}

const workdir = () => {
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
    fail('GITHUB_RUNNER_REQUIRED');
  }
  // Identical to the protected schema operator's credential directory.
  return join(process.env.RUNNER_TEMP, 'dexie-schema-' + process.env.GITHUB_RUN_ID
    + '-' + process.env.GITHUB_RUN_ATTEMPT);
};
const load = async file => JSON.parse(await readFile(file, 'utf8'));

async function main() {
  const mode = process.argv[2];
  if (!['preflight', 'plan', 'recheck', 'verify'].includes(mode) || process.argv.length !== 3) {
    fail('INVALID_ACL_OPERATOR_COMMAND');
  }
  validateAclDispatch(process.env);
  if (mode === 'preflight') {
    console.log('Protected main-only scheduling ACL operation authorized.');
    return;
  }
  const config = await load('dexie-cloud.json');
  if (!record(config) || config.dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');

  const dir = workdir();
  const manifest = await load('cloud/roles.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planSchedulingAcl(manifest, beforeSchema, beforeRoles);

  if (mode === 'plan') {
    if (!process.env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'roles-only-import.json'),
      JSON.stringify(plan.importPayload), { flag: 'wx', mode: 0o600 });
    await appendFile(process.env.GITHUB_OUTPUT, 'change_count=' + plan.changedNames.length + '\n');
    console.log(plan.changedNames.length === 0
      ? 'Scheduling roles already match approved ACL: no import needed.'
      : 'Approved changes for ' + plan.changedNames.join(', ')
        + ': add workoutScheduleRequests permission and update role description only.');
    console.log('No tables, other roles, PLAN grants or FACT grants are in the import.');
    return;
  }

  if (mode === 'recheck') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    if (!isDeepStrictEqual(await load(join(dir, 'roles-only-import.json')), plan.importPayload)) {
      fail('ACL_IMPORT_PAYLOAD_CHANGED');
    }
    if (plan.changedNames.length === 0) fail('NO_ACL_CHANGES_REQUIRED');
    console.log('Remote structure unchanged since preview; exact role delta approved.');
    return;
  }

  if (process.env.DEXIE_ACL_OPERATION !== 'apply') fail('VERIFY_REQUIRES_APPLY');
  verifySchedulingAcl(manifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')));
  console.log('Verified exact Coach/Client scheduling ACL. Other roles and schema unchanged.');
}

if (process.argv[1]?.endsWith('/tools/dexie-roles/scheduling.mjs')) {
  main().catch(error => {
    // Deliberately do not print CLI response bodies or secrets.
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'SCHEDULING_ACL_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
