import cloudConfig from '../../dexie-cloud.json';
import {
  CloudMembershipError, cloudMembershipAdminToken, requireCloudMembershipConfiguration,
  relationshipMembership, type CloudMembershipEnv,
} from './dexie-cloud-membership';
import { validatedPair } from './cloud-contact-profiles';

/**
 * Only tables whose rows can belong to a coach-client realm. Never include
 * personal realms, public catalogue, roles or the system-managed realms/members.
 * Revisit this list whenever the cloud relationship schema grows.
 */
export const TEST_RELATIONSHIP_TABLES = [
  'trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets',
  'workoutOccurrences', 'workoutSessions', 'sessionExercises', 'sessionSets',
  'sessionSetFacts', 'sessionFactExercises', 'sessionFactSets',
  'adHocSessions', 'adHocExercises', 'adHocSets',
  'contactProfiles', 'flexAttributes', 'flexValues',
  'discussionThreads', 'discussionMessages', 'discussionReadStates', 'messageAttachments',
  'workoutScheduleRequests', // Retired table, may still contain older test records.
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(): never {
  throw new CloudMembershipError('CLOUD_MEMBERSHIP_UNAVAILABLE', 502);
}

function conflict(): never {
  throw new CloudMembershipError('CLOUD_MEMBERSHIP_CONFLICT', 409);
}

async function cloudRequest(fetchImpl: typeof fetch, bearer: string, path: string, method = 'GET'): Promise<Response> {
  try {
    return await fetchImpl(cloudConfig.dbUrl + path, {
      method, headers: { Authorization: 'Bearer ' + bearer, Accept: 'application/json' },
    });
  } catch {
    return unavailable();
  }
}

async function realmRows(fetchImpl: typeof fetch, bearer: string, table: string, realmId: string): Promise<string[] | null> {
  const response = await cloudRequest(fetchImpl, bearer,
    '/all/' + encodeURIComponent(table) + '?realmId=' + encodeURIComponent(realmId));
  // Some installations have not yet imported the optional discussion or retired tables.
  if (response.status === 404) return null;
  if (!response.ok) return unavailable();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable();
  }
  if (!Array.isArray(payload) || payload.length > 1000) return unavailable();
  const ids: string[] = [];
  for (const row of payload as unknown[]) {
    if (!isRecord(row) || row.realmId !== realmId || typeof row.id !== 'string' || !row.id) conflict();
    ids.push(row.id);
  }
  if (new Set(ids).size !== ids.length) conflict();
  return ids;
}

/**
 * Privileged, online-only pre-MVP reset. The caller MUST verify the signed Coach
 * and its active D1 projection first. Failures keep that projection active so
 * the same authorized actor can retry an interrupted cleanup.
 */
export async function resetTestCloudRelationship(
  env: CloudMembershipEnv, coachTelegramId: string, clientTelegramId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ realmId: string }> {
  requireCloudMembershipConfiguration(env);
  const { realm, members } = await relationshipMembership(coachTelegramId, clientTelegramId);
  const bearer = await cloudMembershipAdminToken(env, fetchImpl);
  const existing = await cloudRequest(fetchImpl, bearer,
    '/all/realms/' + encodeURIComponent(realm.realmId));
  // Idempotent retry after Cloud deletion succeeded but D1 deactivation failed.
  if (existing.status === 404) return { realmId: realm.realmId };
  if (!existing.ok) return unavailable();

  // Reuse the current authoritative canonical-pair validator. Refuse altered
  // or foreign members and realm metadata before any destructive operation.
  const pair = await validatedPair(fetchImpl, bearer, realm.realmId);
  if (!pair || pair.length !== 2 || !members.every(member =>
    pair.some(row => row.id === member.id && row.userId === member.userId))) conflict();

  // Preflight every installed table before the first write. If the server
  // cannot read even one table, do not begin a destructive partial reset.
  const snapshots: Array<{ table: string; ids: string[] }> = [];
  for (let offset = 0; offset < TEST_RELATIONSHIP_TABLES.length; offset += 4) {
    const chunk = await Promise.all(TEST_RELATIONSHIP_TABLES.slice(offset, offset + 4)
      .map(async table => ({ table, ids: await realmRows(fetchImpl, bearer, table, realm.realmId) })));
    for (const item of chunk) if (item.ids !== null) snapshots.push({ table: item.table, ids: item.ids });
  }

  // REST deletes are not a cross-table transaction. Keep memberships and the
  // D1 link in place until all writes are confirmed; each step is retryable.
  for (const { table, ids } of snapshots) {
    for (let offset = 0; offset < ids.length; offset += 10) {
      const responses = await Promise.all(ids.slice(offset, offset + 10).map(id =>
        cloudRequest(fetchImpl, bearer,
          '/all/' + encodeURIComponent(table) + '/' + encodeURIComponent(id), 'DELETE')));
      if (responses.some(response => !response.ok)) return unavailable();
    }
    const remaining = await realmRows(fetchImpl, bearer, table, realm.realmId);
    if (remaining === null || remaining.length > 0) return unavailable();
  }

  // Realm DELETE cascades its members; deleting only the memberships would
  // leave business records inaccessible and block clean re-invitation.
  const removed = await cloudRequest(fetchImpl, bearer,
    '/all/realms/' + encodeURIComponent(realm.realmId), 'DELETE');
  if (!removed.ok && removed.status !== 404) return unavailable();
  const check = await cloudRequest(fetchImpl, bearer,
    '/all/realms/' + encodeURIComponent(realm.realmId));
  if (check.status !== 404) return unavailable();
  return { realmId: realm.realmId };
}
