import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_CONFIG_PATH = new URL('../../dexie-cloud.json', import.meta.url);
const ROLES_CONFIG_PATH = new URL('../../cloud/roles.json', import.meta.url);
const GLOBAL_SCOPES = ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE'];
const USER_SCOPES = ['ACCESS_DB'];
const FACT_FIELDS = [
  'actualReps', 'actualWeightKg', 'actualDurationSeconds', 'actualDistanceMeters',
  'setLabel', 'rpe', 'comment', 'bands', 'setStatus',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 28);
}

export function telegramUserId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)
    || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('INVALID_TELEGRAM_ID');
  }
  return value;
}

/** IDs are deterministic for an ordered coach-client pair, never for a D1 numeric ID. */
export function relationshipPlan(coachId, clientId) {
  const coach = telegramUserId(coachId);
  const client = telegramUserId(clientId);
  if (coach === client) throw new Error('SELF_RELATIONSHIP_FORBIDDEN');
  const realmId = 'rlm' + digest('mezfit-relationship-v1:' + coach + ':' + client);
  return {
    realm: { realmId, name: 'Mezfit coach-client pilot', owner: null },
    members: [
      {
        id: 'mmb' + digest(realmId + ':coach'),
        realmId,
        userId: 'tg:' + coach,
        invite: false,
        accepted: true,
        roles: ['coach'],
      },
      {
        id: 'mmb' + digest(realmId + ':client'),
        realmId,
        userId: 'tg:' + client,
        invite: false,
        accepted: true,
        roles: ['client'],
      },
    ],
  };
}

function assertUrl(dbUrl) {
  if (typeof dbUrl !== 'string' || !/^https:\/\/[a-z0-9-]+\.dexie\.cloud$/.test(dbUrl)) {
    throw new Error('INVALID_DEXIE_DATABASE_URL');
  }
}

async function request(fetchImpl, dbUrl, path, token, method = 'GET', body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetchImpl(dbUrl + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('DEXIE_NETWORK_FAILURE');
  }
  return response;
}

function assertStatus(response, stage) {
  if (!response.ok) throw new Error('DEXIE_' + stage + '_HTTP_' + response.status);
}

async function json(response, stage) {
  try {
    return await response.json();
  } catch {
    throw new Error('DEXIE_' + stage + '_INVALID_JSON');
  }
}

async function token(fetchImpl, dbUrl, credentials, scopes, claims) {
  const body = {
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scopes,
    ...(claims === undefined ? {} : { claims }),
  };
  const response = await request(fetchImpl, dbUrl, '/token', undefined, 'POST', body);
  assertStatus(response, 'TOKEN');
  const data = await json(response, 'TOKEN');
  if (!isRecord(data) || data.type !== 'tokens' || typeof data.accessToken !== 'string'
    || data.accessToken.length === 0 || (claims && data.claims?.sub !== claims.sub)) {
    throw new Error('DEXIE_TOKEN_INVALID_RESPONSE');
  }
  return data.accessToken;
}

async function getRealm(fetchImpl, dbUrl, bearer, realmId, scope) {
  const response = await request(fetchImpl, dbUrl,
    '/' + scope + '/realms/' + encodeURIComponent(realmId), bearer);
  if (response.status === 404) return null;
  assertStatus(response, 'READ_REALM');
  const value = await json(response, 'READ_REALM');
  if (!isRecord(value) || value.realmId !== realmId) throw new Error('DEXIE_REALM_INVALID_RESPONSE');
  return value;
}

async function listMembers(fetchImpl, dbUrl, bearer, realmId) {
  const response = await request(fetchImpl, dbUrl,
    '/all/members?realmId=' + encodeURIComponent(realmId), bearer);
  assertStatus(response, 'LIST_MEMBERS');
  const value = await json(response, 'LIST_MEMBERS');
  if (!Array.isArray(value) || value.some((m) => !isRecord(m) || m.realmId !== realmId)) {
    throw new Error('DEXIE_MEMBERS_INVALID_RESPONSE');
  }
  return value;
}

async function postRecords(fetchImpl, dbUrl, bearer, table, rows) {
  const response = await request(fetchImpl, dbUrl, '/all/' + table, bearer, 'POST', rows);
  assertStatus(response, 'WRITE_' + table.toUpperCase());
}

function accepted(value) {
  return value === true
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    || (isRecord(value) && value.$t === 'Date'
      && typeof value.v === 'string' && Number.isFinite(Date.parse(value.v)));
}

function assertRealm(value, desired) {
  if (!isRecord(value) || value.realmId !== desired.realmId
    || value.owner !== null || value.name !== desired.name) {
    throw new Error('REALM_OWNERSHIP_OR_IDENTITY_CONFLICT');
  }
}

function assertMembers(actual, desired) {
  if (actual.length > desired.length) throw new Error('UNEXPECTED_REALM_MEMBERS');
  for (const member of actual) {
    const expected = desired.find((candidate) => candidate.id === member.id);
    if (!expected || member.userId !== expected.userId || member.realmId !== expected.realmId
      || !Array.isArray(member.roles) || member.roles.length !== 1
      || member.roles[0] !== expected.roles[0] || member.invite === true
      || !accepted(member.accepted)
      || (member.permissions != null && (!isRecord(member.permissions)
        || Object.keys(member.permissions).length !== 0))) {
      throw new Error('MEMBER_IDENTITY_OR_PERMISSIONS_CONFLICT');
    }
  }
}

function sorted(value) {
  return [...value].sort();
}

function equalItems(left, right) {
  return Array.isArray(left) && JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

/** Explicitly fail closed on drift of the installed global roles. */
export function assertRolePolicy(remoteRoles, localRoles) {
  if (!Array.isArray(remoteRoles) || !isRecord(localRoles)) {
    throw new Error('CLOUD_ROLES_UNAVAILABLE');
  }
  for (const roleName of ['coach', 'client']) {
    const remote = remoteRoles.find((role) => isRecord(role)
      && role.name === roleName && role.realmId === 'rlm-public');
    const local = localRoles[roleName];
    if (!remote || !isRecord(local) || !isRecord(remote.permissions)
      || !isRecord(local.permissions) || !isRecord(local.permissions.update)) {
      throw new Error('CLOUD_ROLE_MISMATCH');
    }
    const permissionKeys = Object.keys(remote.permissions).sort();
    const expectedKeys = roleName === 'coach' ? ['manage', 'update'] : ['update'];
    if (!equalItems(permissionKeys, expectedKeys)
      || !equalItems(Object.keys(local.permissions), expectedKeys)
      || (roleName === 'coach' && (!equalItems(remote.permissions.manage, ['trainingPlans'])
        || !equalItems(local.permissions.manage, ['trainingPlans'])))
      || !isRecord(remote.permissions.update)
      || !equalItems(Object.keys(remote.permissions.update), ['sessionSetFacts'])
      || !equalItems(remote.permissions.update.sessionSetFacts, FACT_FIELDS)
      || !equalItems(local.permissions.update.sessionSetFacts, FACT_FIELDS)) {
      throw new Error('CLOUD_ROLE_MISMATCH');
    }
  }
}

async function verifyUserVisibility(fetchImpl, dbUrl, credentials, member, expectedRealm) {
  const userBearer = await token(fetchImpl, dbUrl, credentials, USER_SCOPES, { sub: member.userId });
  const visibleRealm = await getRealm(fetchImpl, dbUrl, userBearer, expectedRealm.realmId, 'my');
  if (visibleRealm === null) throw new Error('MEMBERSHIP_NOT_VISIBLE');
  assertRealm(visibleRealm, expectedRealm);
}

/**
 * Administrative pilot only: no HTTP route and no D1 writes.
 * A failed operation may leave a partial realm/membership; the next attempt
 * checks every existing record and safely resumes missing writes.
 */
export async function provisionRelationship({ dbUrl, credentials, coachId, clientId,
  fetchImpl = fetch, localRoles, apply = false }) {
  assertUrl(dbUrl);
  const plan = relationshipPlan(coachId, clientId);
  if (!apply) return { realmId: plan.realm.realmId, applied: false };

  if (!isRecord(credentials) || typeof credentials.clientId !== 'string'
    || !credentials.clientId || typeof credentials.clientSecret !== 'string'
    || !credentials.clientSecret) {
    throw new Error('ADMIN_CREDENTIALS_REQUIRED');
  }
  const admin = await token(fetchImpl, dbUrl, credentials, GLOBAL_SCOPES);
  const remoteRolesResponse = await request(fetchImpl, dbUrl, '/public/roles', undefined);
  assertStatus(remoteRolesResponse, 'READ_ROLES');
  assertRolePolicy(await json(remoteRolesResponse, 'READ_ROLES'), localRoles);

  const existingRealm = await getRealm(fetchImpl, dbUrl, admin, plan.realm.realmId, 'all');
  if (existingRealm) assertRealm(existingRealm, plan.realm);
  const existingMembers = await listMembers(fetchImpl, dbUrl, admin, plan.realm.realmId);
  assertMembers(existingMembers, plan.members);

  if (!existingRealm) {
    await postRecords(fetchImpl, dbUrl, admin, 'realms', [plan.realm]);
    assertRealm(await getRealm(fetchImpl, dbUrl, admin, plan.realm.realmId, 'all'), plan.realm);
  }
  const missing = plan.members.filter((desired) =>
    !existingMembers.some((member) => member.id === desired.id));
  if (missing.length) await postRecords(fetchImpl, dbUrl, admin, 'members', missing);

  const finalMembers = await listMembers(fetchImpl, dbUrl, admin, plan.realm.realmId);
  assertMembers(finalMembers, plan.members);
  if (finalMembers.length !== 2) throw new Error('INCOMPLETE_REALM_MEMBERSHIP');

  for (const member of plan.members) {
    await verifyUserVisibility(fetchImpl, dbUrl, credentials, member, plan.realm);
  }
  return { realmId: plan.realm.realmId, applied: true, membersVerified: 2 };
}

function argsFromCli(args) {
  const parsed = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') {
      parsed.apply = true;
    } else if (['--coach', '--client', '--key'].includes(arg)) {
      const key = { '--coach': 'coachId', '--client': 'clientId', '--key': 'keyFile' }[arg];
      if (parsed[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('INVALID_CLI_ARGUMENTS');
      }
      parsed[key] = args[++i];
    } else {
      throw new Error('INVALID_CLI_ARGUMENTS');
    }
  }
  if (!parsed.coachId || !parsed.clientId) throw new Error('COACH_AND_CLIENT_IDS_REQUIRED');
  return parsed;
}

function readKey(path, dbUrl) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))[dbUrl];
    if (!isRecord(value) || typeof value.clientId !== 'string'
      || typeof value.clientSecret !== 'string') {
      throw new Error('invalid');
    }
    return { clientId: value.clientId, clientSecret: value.clientSecret };
  } catch {
    throw new Error('ADMIN_KEY_FILE_UNAVAILABLE_OR_INVALID');
  }
}

export async function main(args = process.argv.slice(2)) {
  const cli = argsFromCli(args);
  const config = JSON.parse(readFileSync(DB_CONFIG_PATH, 'utf8'));
  const roles = JSON.parse(readFileSync(ROLES_CONFIG_PATH, 'utf8')).roles;
  const keyFile = cli.keyFile ?? process.env.DEXIE_CLOUD_ADMIN_KEY_FILE;
  if (cli.apply && !keyFile) throw new Error('ADMIN_KEY_FILE_REQUIRED_FOR_APPLY');
  const result = await provisionRelationship({
    dbUrl: config.dbUrl, coachId: cli.coachId, clientId: cli.clientId,
    credentials: cli.apply ? readKey(keyFile, config.dbUrl) : undefined,
    localRoles: roles, apply: cli.apply,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Only our controlled, constant error codes are printed. No Dexie payload or credentials.
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'BOOTSTRAP_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
