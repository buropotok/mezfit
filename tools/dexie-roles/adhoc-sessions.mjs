#!/usr/bin/env node
/** Protected additive schema + Coach-only ACL exception; never imports business data. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const CONFIRMATION = 'APPLY_ADHOC_SESSION_SCHEMA_AND_COACH_ACL';
const DB_URL = 'https://zjv60oxag.dexie.cloud';
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const EXPECTED_CALENDAR_ROLES = deepFreeze({
  "coach": {
    "displayName": "Coach",
    "description": "Can author assigned PLAN and scheduled workouts; session lifecycle stays privileged",
    "sortOrder": 1,
    "permissions": {
      "manage": [
        "trainingPlans",
        "programPhases",
        "programDays",
        "programExercises",
        "programSets"
      ],
      "update": {
        "sessionSetFacts": [
          "actualReps",
          "actualWeightKg",
          "actualDurationSeconds",
          "actualDistanceMeters",
          "setLabel",
          "rpe",
          "comment",
          "bands",
          "setStatus"
        ],
        "workoutOccurrences": [
          "startsAtUtc",
          "durationMinutes",
          "cancelledAt",
          "updatedAt",
          "plan",
          "publicationStatus",
          "originalPlan",
          "publishedPlan",
          "draftAuthorUserId"
        ]
      },
      "add": [
        "workoutOccurrences"
      ]
    }
  },
  "client": {
    "displayName": "Client",
    "description": "Can schedule workouts and update calendar timing; assigned PLAN and session lifecycle stay protected",
    "sortOrder": 2,
    "permissions": {
      "update": {
        "sessionSetFacts": [
          "actualReps",
          "actualWeightKg",
          "actualDurationSeconds",
          "actualDistanceMeters",
          "setLabel",
          "rpe",
          "comment",
          "bands",
          "setStatus"
        ],
        "workoutOccurrences": [
          "startsAtUtc",
          "durationMinutes",
          "cancelledAt",
          "updatedAt",
          "publicationStatus",
          "draftAuthorUserId"
        ]
      },
      "add": [
        "workoutOccurrences"
      ]
    }
  }
});
export const ADHOC_ROLE_OVERLAY = deepFreeze({
  "roles": {
    "coach": {
      "permissions": {
        "add": [
          "adHocSessions",
          "adHocExercises",
          "adHocSets"
        ],
        "update": {
          "adHocSessions": [
            "name",
            "comment",
            "status",
            "completedAt",
            "templateSaveDecision",
            "updatedAt"
          ],
          "adHocExercises": [
            "position",
            "deletedAt",
            "notes"
          ],
          "adHocSets": [
            "position",
            "deletedAt",
            "setType",
            "actualReps",
            "actualWeightKg",
            "actualDurationSeconds",
            "actualDistanceMeters",
            "setLabel",
            "rpe",
            "comment",
            "bands",
            "setStatus"
          ]
        }
      }
    }
  }
});
export const ADHOC_SCHEMA = deepFreeze({
  "schema": {
    "adHocSessions": "@id",
    "adHocExercises": "@id",
    "adHocSets": "@id"
  }
});

const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };

/** Pure exact profile for membership preflights; does not read files or start work. */
export function buildExpectedAdHocRoles(calendarRoles = EXPECTED_CALENDAR_ROLES) {
  equal(calendarRoles, EXPECTED_CALENDAR_ROLES, 'UNEXPECTED_CALENDAR_BASELINE');
  const roles = structuredClone(calendarRoles);
  roles.coach.permissions.add.push(...ADHOC_ROLE_OVERLAY.roles.coach.permissions.add);
  Object.assign(roles.coach.permissions.update,
    structuredClone(ADHOC_ROLE_OVERLAY.roles.coach.permissions.update));
  return roles;
}
export const EXPECTED_ADHOC_ROLES = deepFreeze(buildExpectedAdHocRoles());

export function assertApprovedManifests(overlay, schemaManifest) {
  equal(overlay, ADHOC_ROLE_OVERLAY, 'INVALID_ADHOC_ROLE_OVERLAY');
  equal(schemaManifest, ADHOC_SCHEMA, 'INVALID_ADHOC_SCHEMA_MANIFEST');
}
function assertStructure(schema, roles) {
  if (!record(schema) || !record(schema.schema) || !record(roles) || !record(roles.roles)) {
    fail('INVALID_CLOUD_STRUCTURE');
  }
}

export function planAdHocSessions(overlay, schemaManifest, beforeSchema, beforeRoles) {
  assertApprovedManifests(overlay, schemaManifest);
  assertStructure(beforeSchema, beforeRoles);
  const schema = {};
  for (const [name, key] of Object.entries(ADHOC_SCHEMA.schema)) {
    if (!Object.hasOwn(beforeSchema.schema, name)) schema[name] = key;
    else equal(beforeSchema.schema[name], key, 'INCOMPATIBLE_ADHOC_TABLE');
  }
  // No historical calendar upgrades here: install calendar first. Support exact
  // partial installation after a failed import, without widening any other grant.
  equal(beforeRoles.roles.client, EXPECTED_CALENDAR_ROLES.client, 'UNEXPECTED_CLIENT_ROLE');
  const coach = beforeRoles.roles.coach;
  if (!isDeepStrictEqual(coach, EXPECTED_CALENDAR_ROLES.coach)
    && !isDeepStrictEqual(coach, EXPECTED_ADHOC_ROLES.coach)) fail('UNEXPECTED_COACH_ROLE');
  const roles = isDeepStrictEqual(coach, EXPECTED_ADHOC_ROLES.coach)
    ? {} : { coach: structuredClone(EXPECTED_ADHOC_ROLES.coach) };
  const importPayload = {};
  if (Object.keys(schema).length) importPayload.schema = schema;
  if (Object.keys(roles).length) importPayload.roles = roles;
  return { importPayload, addedTables: Object.keys(schema), changedRoles: Object.keys(roles),
    changeCount: Object.keys(schema).length + Object.keys(roles).length };
}

export function assertExactImportPayload(expected, actual) {
  equal(actual, expected, 'ADHOC_IMPORT_PAYLOAD_CHANGED');
}
export function assertUnchangedBeforeApply(beforeSchema, beforeRoles, currentSchema, currentRoles) {
  equal(currentSchema, beforeSchema, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  equal(currentRoles, beforeRoles, 'CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
}
export function verifyAdHocSessions(overlay, schemaManifest, beforeSchema, beforeRoles, afterSchema, afterRoles) {
  planAdHocSessions(overlay, schemaManifest, beforeSchema, beforeRoles);
  assertStructure(afterSchema, afterRoles);
  const expectedSchema = structuredClone(beforeSchema);
  Object.assign(expectedSchema.schema, ADHOC_SCHEMA.schema);
  const expectedRoles = structuredClone(beforeRoles);
  expectedRoles.roles.coach = structuredClone(EXPECTED_ADHOC_ROLES.coach);
  // Full envelopes: sealed flag, all old tables, unknown metadata, unrelated
  // roles, Client and existing Coach grants must survive byte-semantically.
  equal(afterSchema, expectedSchema, 'UNEXPECTED_SCHEMA_READBACK');
  equal(afterRoles, expectedRoles, 'UNEXPECTED_ROLES_READBACK');
}
export function validateAdHocDispatch(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    fail('UNAUTHORIZED_ADHOC_DISPATCH');
  }
  if (!['preview', 'apply'].includes(env.DEXIE_ADHOC_OPERATION)) fail('INVALID_ADHOC_OPERATION');
  if (env.DEXIE_ADHOC_OPERATION === 'apply') {
    if (env.DEXIE_ADHOC_CONFIRMATION !== CONFIRMATION) fail('INVALID_ADHOC_CONFIRMATION');
  } else if (env.DEXIE_ADHOC_CONFIRMATION) fail('PREVIEW_MUST_NOT_HAVE_APPLY_CONFIRMATION');
}
const load = async file => JSON.parse(await readFile(file, 'utf8'));
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['preflight', 'plan', 'recheck', 'verify'].includes(mode)) {
    fail('INVALID_ADHOC_OPERATOR_COMMAND');
  }
  validateAdHocDispatch(process.env);
  if (mode === 'preflight') {
    console.log('Protected main/owner ad-hoc schema and ACL dispatch authorized.');
    return;
  }
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  const env = process.env;
  if (!env.RUNNER_TEMP || !env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const overlay = await load('cloud/adhoc-session-roles.json');
  const schemaManifest = await load('cloud/schema-adhoc-sessions.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const plan = planAdHocSessions(overlay, schemaManifest, beforeSchema, beforeRoles);
  if (mode === 'plan') {
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT_REQUIRED');
    await writeFile(join(dir, 'adhoc-import.json'), JSON.stringify(plan.importPayload), { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'change_count=' + plan.changeCount + '\n');
    console.log('Approved missing tables: ' + (plan.addedTables.join(', ') || 'none'));
    console.log('Approved role changes: ' + (plan.changedRoles.join(', ') || 'none'));
    return;
  }
  if (env.DEXIE_ADHOC_OPERATION !== 'apply') fail('APPLY_REQUIRED');
  if (mode === 'recheck') {
    assertUnchangedBeforeApply(beforeSchema, beforeRoles,
      await load(join(dir, 'current-schema.json')), await load(join(dir, 'current-roles.json')));
    assertExactImportPayload(plan.importPayload, await load(join(dir, 'adhoc-import.json')));
    if (!plan.changeCount) fail('NO_ADHOC_CHANGES_REQUIRED');
    console.log('Exact schema/roles and reviewed payload rechecked immediately before import.');
    return;
  }
  verifyAdHocSessions(overlay, schemaManifest, beforeSchema, beforeRoles,
    await load(join(dir, 'after-schema.json')), await load(join(dir, 'after-roles.json')));
  console.log('Exact additive schema and Coach ACL readback verified; no business permission test performed.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'ADHOC_CONFIGURATION_OPERATION_FAILED');
    process.exitCode = 1;
  });
}
