import { describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from './dexie-cloud-membership';
import { resetTestCloudRelationship, TEST_RELATIONSHIP_TABLES } from './test-relationship-reset';

const env = {
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID: 'manager-id',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET: 'manager-secret',
  DEXIE_CLOUD_CLIENT_ID: 'auth-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'auth-secret',
};

async function setup() {
  const target = await relationshipMembership('101', '202');
  const other = await relationshipMembership('101', '303');
  const realms = new Map([target.realm, other.realm].map(r => [r.realmId, r]));
  const members = [...target.members, ...other.members].map(member => ({ ...member, accepted: true }));
  const rows = new Map<string, Array<{ id: string; realmId: string }>>([
    ['trainingPlans', [{ id: 'plan-one', realmId: target.realm.realmId }, { id: 'plan-two', realmId: other.realm.realmId }]],
    ['discussionMessages', [{ id: 'message-one', realmId: target.realm.realmId }]],
  ]);
  let failTable = '';
  let failDelete = '';
  const calls: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const u = new URL(String(input)), path = u.pathname, method = init?.method ?? 'GET';
    calls.push(method + ' ' + path);
    if (path === '/token') return Response.json({ type: 'tokens', accessToken: 'manager' });
    if (path === '/all/members') return Response.json(members.filter(m => m.realmId === u.searchParams.get('realmId')));
    if (path.startsWith('/all/realms/')) {
      const id = path.slice('/all/realms/'.length);
      if (method === 'GET') return realms.has(id) ? Response.json(realms.get(id)) : new Response(null, { status: 404 });
      if (method === 'DELETE') {
        realms.delete(id);
        for (let i = members.length - 1; i >= 0; i--) if (members[i].realmId === id) members.splice(i, 1);
        return new Response(null, { status: 204 });
      }
    }
    const parts = path.split('/').filter(Boolean), table = parts[1];
    if (parts[0] === 'all' && TEST_RELATIONSHIP_TABLES.some(name => name === table)) {
      if (method === 'GET') {
        if (failTable === table) return new Response(null, { status: 503 });
        return Response.json((rows.get(table) ?? []).filter(row => row.realmId === u.searchParams.get('realmId')));
      }
      if (method === 'DELETE') {
        if (failDelete === table) {
          failDelete = '';
          return new Response(null, { status: 503 });
        }
        rows.set(table, (rows.get(table) ?? []).filter(row => row.id !== parts[2]));
        return new Response(null, { status: 204 });
      }
    }
    throw Error('Unexpected request ' + method + ' ' + path);
  });
  return { target, other, realms, members, rows, calls, fetchImpl, fail: (table: string) => { failTable = table; }, failDeleteOnce: (table: string) => { failDelete = table; } };
}

describe('test relationship reset in Dexie Cloud', () => {
  it('removes only the selected realm, its data and members', async () => {
    const f = await setup();
    await resetTestCloudRelationship(env, '101', '202', f.fetchImpl);
    expect(f.realms.has(f.target.realm.realmId)).toBe(false);
    expect(f.members.filter(m => m.realmId === f.target.realm.realmId)).toHaveLength(0);
    expect(f.rows.get('trainingPlans')).toEqual([{ id: 'plan-two', realmId: f.other.realm.realmId }]);
    expect(f.rows.get('discussionMessages')).toEqual([]);
    expect(f.realms.has(f.other.realm.realmId)).toBe(true);
  });

  it('refuses altered membership before any destructive write', async () => {
    const f = await setup();
    f.members[1].roles = ['coach'];
    await expect(resetTestCloudRelationship(env, '101', '202', f.fetchImpl))
      .rejects.toMatchObject({ code: 'CLOUD_MEMBERSHIP_CONFLICT' });
    expect(f.calls.some(call => call.startsWith('DELETE'))).toBe(false);
  });

  it('fails closed on preflight error and can be retried', async () => {
    const f = await setup();
    f.fail('trainingPlans');
    await expect(resetTestCloudRelationship(env, '101', '202', f.fetchImpl))
      .rejects.toMatchObject({ code: 'CLOUD_MEMBERSHIP_UNAVAILABLE' });
    expect(f.calls.some(call => call.startsWith('DELETE'))).toBe(false);
    f.fail('');
    await resetTestCloudRelationship(env, '101', '202', f.fetchImpl);
    expect(f.realms.has(f.target.realm.realmId)).toBe(false);
  });

  it('retries a partially deleted realm without revoking membership prematurely', async () => {
    const f = await setup();
    f.failDeleteOnce('trainingPlans');
    await expect(resetTestCloudRelationship(env, '101', '202', f.fetchImpl))
      .rejects.toMatchObject({ code: 'CLOUD_MEMBERSHIP_UNAVAILABLE' });
    expect(f.realms.has(f.target.realm.realmId)).toBe(true);
    expect(f.members.filter(m => m.realmId === f.target.realm.realmId)).toHaveLength(2);
    await resetTestCloudRelationship(env, '101', '202', f.fetchImpl);
    expect(f.realms.has(f.target.realm.realmId)).toBe(false);
  });

  it('accepts already deleted realm for retry after D1 failure', async () => {
    const f = await setup();
    f.realms.delete(f.target.realm.realmId);
    await expect(resetTestCloudRelationship(env, '101', '202', f.fetchImpl))
      .resolves.toEqual({ realmId: f.target.realm.realmId });
  });

  it('requires existing privileged credentials', async () => {
    const f = await setup();
    await expect(resetTestCloudRelationship({}, '101', '202', f.fetchImpl))
      .rejects.toMatchObject({ status: 503 });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
