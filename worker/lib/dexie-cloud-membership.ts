import cloudConfig from '../../dexie-cloud.json';
import roleConfig from '../../cloud/roles.json';
import { relationshipRealmId, stableCloudRelationshipId } from '../../shared/relationship-id';

export interface CloudMembershipEnv {
  // This is a dedicated backend-only credential. Never reuse the Telegram token service account.
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID?: string;
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET?: string;
  DEXIE_CLOUD_CLIENT_ID?: string;
  DEXIE_CLOUD_CLIENT_SECRET?: string;
}

type CloudMemberRole = 'coach' | 'client';

interface CloudMember {
  id: string;
  realmId: string;
  userId: string;
  // Synced relationship display label sourced from verified Telegram identity.
  name?: string;
  owner: null;
  roles: CloudMemberRole[];
  invite: false;
  accepted: true;
}

interface CloudRealm {
  realmId: string;
  name: string;
  owner: null;
}

export class CloudMembershipError extends Error {
  constructor(
    readonly code: 'CLOUD_MEMBERSHIP_NOT_CONFIGURED' | 'CLOUD_MEMBERSHIP_UNAVAILABLE'
      | 'CLOUD_MEMBERSHIP_CONFLICT',
    readonly status: 503 | 502 | 409,
  ) {
    super(code);
    this.name = 'CloudMembershipError';
  }
}

function failUnavailable(): never {
  throw new CloudMembershipError('CLOUD_MEMBERSHIP_UNAVAILABLE', 502);
}

function failConflict(): never {
  throw new CloudMembershipError('CLOUD_MEMBERSHIP_CONFLICT', 409);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function telegramId(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))
    || String(Number(value)) !== value) failConflict();
  return value;
}

export interface RelationshipNames {
  coach: string;
  client: string;
}

function memberName(value: string): string | undefined {
  const trimmed = value.trim().slice(0, 120);
  return trimmed || undefined;
}

export async function relationshipMembership(
  coachTelegramId: string,
  clientTelegramId: string,
  names?: RelationshipNames,
): Promise<{ realm: CloudRealm; members: [CloudMember, CloudMember] }> {
  const coach = telegramId(coachTelegramId);
  const client = telegramId(clientTelegramId);
  if (coach === client) failConflict();
  const coachName = names ? memberName(names.coach) : undefined;
  const clientName = names ? memberName(names.client) : undefined;

  // Must match the deterministic IDs in the existing administrative pilot.
  const realmId = await relationshipRealmId(coach, client);
  return {
    realm: { realmId, name: 'Mezfit coach-client pilot', owner: null },
    members: [
      {
        id: await stableCloudRelationshipId('mmb', realmId + ':coach'),
        realmId,
        userId: 'tg:' + coach,
        ...(coachName ? { name: coachName } : {}),
        owner: null,
        invite: false,
        accepted: true,
        roles: ['coach'],
      },
      {
        id: await stableCloudRelationshipId('mmb', realmId + ':client'),
        realmId,
        userId: 'tg:' + client,
        ...(clientName ? { name: clientName } : {}),
        owner: null,
        invite: false,
        accepted: true,
        roles: ['client'],
      },
    ],
  };
}

async function upstream(
  fetchImpl: typeof fetch,
  path: string,
  token?: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  try {
    return await fetchImpl(cloudConfig.dbUrl + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return failUnavailable();
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) failUnavailable();
  try {
    return await response.json() as unknown;
  } catch {
    return failUnavailable();
  }
}

async function token(
  fetchImpl: typeof fetch,
  credentials: { id: string; secret: string },
  scopes: string[],
  userId?: string,
): Promise<string> {
  const value = await json(await upstream(fetchImpl, '/token', undefined, 'POST', {
    grant_type: 'client_credentials',
    scopes,
    client_id: credentials.id,
    client_secret: credentials.secret,
    ...(userId === undefined ? {} : { claims: { sub: userId } }),
  }));
  if (!isObject(value) || value.type !== 'tokens'
    || typeof value.accessToken !== 'string' || !value.accessToken
    || (userId && (!isObject(value.claims) || value.claims.sub !== userId))) {
    failUnavailable();
  }
  return value.accessToken;
}

/** Trusted server-only administration; this token must never reach the browser. */
export async function cloudMembershipAdminToken(
  env: CloudMembershipEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  requireCloudMembershipConfiguration(env);
  return token(fetchImpl, {
    id: env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID,
    secret: env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET,
  }, ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE']);
}

export async function cloudMembershipAdminRead(
  fetchImpl: typeof fetch, bearer: string, path: string,
): Promise<unknown> {
  return json(await upstream(fetchImpl, path, bearer));
}

export async function cloudMembershipAdminUpsertProfiles(
  fetchImpl: typeof fetch, bearer: string, rows: readonly Record<string, unknown>[],
): Promise<void> {
  if (rows.length) {
    const response = await upstream(fetchImpl, '/all/contactProfiles', bearer, 'POST', [...rows]);
    if (!response.ok) failUnavailable();
  }
}

function sameStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && expected.every((item) => value.includes(item))
    && value.every((item) => typeof item === 'string');
}

function assertRemoteRoles(value: unknown): void {
  if (!Array.isArray(value)) failUnavailable();
  const expected = roleConfig.roles;
  const expectedFacts = expected.client.permissions.update.sessionSetFacts;
  for (const name of ['coach', 'client'] as const) {
    const remote = value.find((candidate: unknown) => isObject(candidate)
      && candidate.realmId === 'rlm-public' && candidate.name === name);
    if (!isObject(remote) || !isObject(remote.permissions)) failUnavailable();
    const permissions = remote.permissions;
    const keys = name === 'coach' ? ['manage', 'update'] : ['update'];
    // Deploy this compatible Worker before expanding Dexie Cloud roles.
    const compatibleCoach = sameStrings(permissions.manage, ['trainingPlans'])
      || sameStrings(permissions.manage, ['trainingPlans', 'programPhases']);
    if (!sameStrings(Object.keys(permissions), keys)
      || (name === 'coach' && !compatibleCoach)
      || !isObject(permissions.update)
      || !sameStrings(Object.keys(permissions.update), ['sessionSetFacts'])
      || !sameStrings(permissions.update.sessionSetFacts, expectedFacts)) failUnavailable();
  }
}

function assertRealm(value: unknown, expected: CloudRealm): void {
  if (!isObject(value) || value.realmId !== expected.realmId
    || value.name !== expected.name || value.owner !== null) failConflict();
}

function accepted(value: unknown): boolean {
  return value === true
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    || (isObject(value) && value.$t === 'Date' && typeof value.v === 'string'
      && Number.isFinite(Date.parse(value.v)));
}

function assertMembers(value: unknown, expected: CloudMember[]): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > expected.length) failConflict();
  for (const member of value) {
    if (!isObject(member)) failConflict();
    const desired = expected.find((candidate) => candidate.id === member.id);
    if (!desired || member.realmId !== desired.realmId || member.userId !== desired.userId
      || member.owner !== null || !sameStrings(member.roles, desired.roles)
      || member.invite === true || !accepted(member.accepted)
      || (member.permissions != null
        && (!isObject(member.permissions) || Object.keys(member.permissions).length !== 0))) {
      failConflict();
    }
  }
}

async function getRealm(
  fetchImpl: typeof fetch, accessToken: string, realmId: string, scope: 'all' | 'my',
): Promise<unknown | null> {
  const response = await upstream(fetchImpl, '/' + scope + '/realms/' + encodeURIComponent(realmId), accessToken);
  if (response.status === 404) return null;
  return json(response);
}

async function list(
  fetchImpl: typeof fetch, accessToken: string, table: 'members' | 'roles', realmId: string,
): Promise<unknown> {
  return json(await upstream(
    fetchImpl, '/all/' + table + '?realmId=' + encodeURIComponent(realmId), accessToken,
  ));
}

async function write(
  fetchImpl: typeof fetch, accessToken: string, table: 'realms' | 'members', records: unknown[],
): Promise<void> {
  const response = await upstream(fetchImpl, '/all/' + table, accessToken, 'POST', records);
  if (!response.ok) failUnavailable();
}

export function requireCloudMembershipConfiguration(env: CloudMembershipEnv): asserts env is Required<CloudMembershipEnv> {
  if (!env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID || !env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET
    || !env.DEXIE_CLOUD_CLIENT_ID || !env.DEXIE_CLOUD_CLIENT_SECRET) {
    throw new CloudMembershipError('CLOUD_MEMBERSHIP_NOT_CONFIGURED', 503);
  }
}

/**
 * Server-only invitation acceptance. A partially provisioned realm is resumed on retry.
 * Dexie Cloud membership is authoritative; the legacy D1 relationship projection is
 * written by the caller only after the cloud confirms both identities and visibility.
 */
export async function provisionInviteMembership(
  env: CloudMembershipEnv,
  coachTelegramId: string,
  clientTelegramId: string,
  fetchImpl: typeof fetch = fetch,
  names?: RelationshipNames,
): Promise<{ realmId: string }> {
  // Reject missing secrets before any remote or legacy database mutation.
  requireCloudMembershipConfiguration(env);

  const { realm, members } = await relationshipMembership(coachTelegramId, clientTelegramId, names);
  const admin = await cloudMembershipAdminToken(env, fetchImpl);

  // User impersonation belongs only to the narrow auth service account; never
  // give the administrative account IMPERSONATE or the auth account GLOBAL_*.
  const userTokens = await Promise.all(members.map((member) => token(fetchImpl, {
    id: env.DEXIE_CLOUD_CLIENT_ID,
    secret: env.DEXIE_CLOUD_CLIENT_SECRET,
  }, ['ACCESS_DB'], member.userId)));

  assertRemoteRoles(await json(await upstream(fetchImpl, '/public/roles')));
  const overrides = await list(fetchImpl, admin, 'roles', realm.realmId);
  if (!Array.isArray(overrides) || overrides.some((role) => !isObject(role)
    || role.realmId !== realm.realmId)) failUnavailable();
  if (overrides.length) failConflict();

  const existingRealm = await getRealm(fetchImpl, admin, realm.realmId, 'all');
  if (existingRealm !== null) assertRealm(existingRealm, realm);
  const existingMembers = await list(fetchImpl, admin, 'members', realm.realmId);
  assertMembers(existingMembers, members);

  if (existingRealm === null) {
    await write(fetchImpl, admin, 'realms', [realm]);
    assertRealm(await getRealm(fetchImpl, admin, realm.realmId, 'all'), realm);
  }

  const missing = members.filter((member) =>
    !existingMembers.some((existing) => existing.id === member.id));
  if (missing.length) await write(fetchImpl, admin, 'members', missing);

  const finalMembers = await list(fetchImpl, admin, 'members', realm.realmId);
  assertMembers(finalMembers, members);
  if (finalMembers.length !== members.length) failUnavailable();
  for (const bearer of userTokens) {
    assertRealm(await getRealm(fetchImpl, bearer, realm.realmId, 'my'), realm);
  }
  return { realmId: realm.realmId };
}
