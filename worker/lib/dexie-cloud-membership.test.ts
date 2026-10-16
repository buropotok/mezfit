import { describe, expect, it, vi } from 'vitest';
import roleConfig from '../../cloud/roles.json';
import {
  CloudMembershipError, provisionInviteMembership, relationshipMembership,
  requireCloudMembershipConfiguration,
} from './dexie-cloud-membership';

const env = {
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID: 'manager-id',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET: 'manager-secret',
  DEXIE_CLOUD_CLIENT_ID: 'telegram-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'telegram-secret',
};

function fakeCloud() {
  const realms = new Map<string, Record<string, unknown>>();
  const members = new Map<string, Record<string, unknown>>();
  const requests: Array<{ path: string; method: string; data?: Record<string, unknown> | Record<string, unknown>[] }> = [];
  const installedRoles = (['coach', 'client'] as const).map((name) => ({
    realmId: 'rlm-public', name, permissions: structuredClone(roleConfig.roles[name].permissions),
  }));
  let failNextWrite = false;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const data = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> | Record<string, unknown>[] : undefined;
    requests.push({ path, method, data });

    if (path === '/token' && method === 'POST') {
      if (!data || Array.isArray(data)) throw Error('invalid fixture');
      const manager = data.client_id === env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID
        && data.client_secret === env.DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET;
      const telegram = data.client_id === env.DEXIE_CLOUD_CLIENT_ID
        && data.client_secret === env.DEXIE_CLOUD_CLIENT_SECRET;
      if (!manager && !telegram) return Response.json({}, { status: 403 });
      if (manager && JSON.stringify(data.scopes) !== '["ACCESS_DB","GLOBAL_READ","GLOBAL_WRITE"]') {
        return Response.json({}, { status: 403 });
      }
      if (telegram && JSON.stringify(data.scopes) !== '["ACCESS_DB"]') {
        return Response.json({}, { status: 403 });
      }
      if (telegram && (!data.claims || !('sub' in (data.claims as object)))) {
        return Response.json({}, { status: 403 });
      }
      const subject = telegram ? String((data.claims as { sub: string }).sub) : 'server';
      return Response.json({ type: 'tokens', accessToken: (manager ? 'manager' : subject),
        claims: { sub: subject } });
    }

    if (path === '/public/roles' && method === 'GET') return Response.json(installedRoles);

    const bearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '');
    if (path === '/all/roles' && bearer === 'manager') return Response.json([]);
    if (path === '/all/members' && method === 'GET' && bearer === 'manager') {
      return Response.json([...members.values()].filter((m) => m.realmId === url.searchParams.get('realmId')));
    }
    if (path.startsWith('/all/realms/') && method === 'GET' && bearer === 'manager') {
      const realm = realms.get(path.slice('/all/realms/'.length));
      return realm ? Response.json(realm) : new Response(null, { status: 404 });
    }
    if (path === '/all/realms' && method === 'POST' && bearer === 'manager') {
      if (failNextWrite) {
        failNextWrite = false;
        return new Response(null, { status: 503 });
      }
      for (const realm of data as Record<string, unknown>[]) {
        realms.set(String(realm.realmId), structuredClone(realm));
      }
      return new Response(null, { status: 204 });
    }
    if (path === '/all/members' && method === 'POST' && bearer === 'manager') {
      if (failNextWrite) {
        failNextWrite = false;
        return new Response(null, { status: 503 });
      }
      for (const member of data as Record<string, unknown>[]) {
        members.set(String(member.id), {
          ...structuredClone(member),
          accepted: { $t: 'Date', v: '2026-10-12T00:00:00Z' },
        });
      }
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/my/realms/') && bearer?.startsWith('tg:')) {
      const realmId = path.slice('/my/realms/'.length);
      const permitted = [...members.values()].some((member) =>
        member.realmId === realmId && member.userId === bearer);
      const realm = realms.get(realmId);
      return permitted && realm ? Response.json(realm) : new Response(null, { status: 404 });
    }
    throw Error('Unexpected cloud request: ' + method + ' ' + path);
  });
  return {
    fetchImpl, realms, members, installedRoles, requests,
    failOneWrite: () => { failNextWrite = true; },
  };
}

describe('automatic Dexie Cloud relationship provisioning', () => {
  it('uses the existing deterministic pilot identifiers, without granting member ownership', async () => {
    const planned = await relationshipMembership('101', '202');
    expect(planned.realm.realmId).toMatch(/^rlm[a-f0-9]{28}$/);
    expect(planned.realm).toMatchObject({ owner: null, name: 'Mezfit coach-client pilot' });
    expect(planned.members.map((member) => member.roles)).toEqual([['coach'], ['client']]);
    expect(planned.members.map((member) => member.userId)).toEqual(['tg:101', 'tg:202']);
    expect(planned.members.every((member) => member.owner === null
      && member.invite === false && member.accepted === true)).toBe(true);
    expect(await relationshipMembership('101', '202')).toEqual(planned);
    expect((await relationshipMembership('202', '101')).realm.realmId).not.toBe(planned.realm.realmId);
  });

  it('rejects invalid and forged user identities without creating a realm', async () => {
    for (const invalid of ['0', '-1', 'tg:101', '1.4', '01', '9007199254740992']) {
      await expect(relationshipMembership(invalid, '202')).rejects.toMatchObject({
        code: 'CLOUD_MEMBERSHIP_CONFLICT',
      });
    }
    await expect(relationshipMembership('101', '101')).rejects.toBeInstanceOf(CloudMembershipError);
  });

  it('does not contact cloud when separate admin or auth credentials are missing', async () => {
    const cloud = fakeCloud();
    expect(() => requireCloudMembershipConfiguration({})).toThrow('CLOUD_MEMBERSHIP_NOT_CONFIGURED');
    await expect(provisionInviteMembership({}, '101', '202', cloud.fetchImpl)).rejects.toMatchObject({
      status: 503,
    });
    expect(cloud.fetchImpl).not.toHaveBeenCalled();
  });

  it('creates two accepted role-restricted members and verifies their visibility', async () => {
    const cloud = fakeCloud();
    const result = await provisionInviteMembership(env, '101', '202', cloud.fetchImpl);
    expect(result.realmId).toBe((await relationshipMembership('101', '202')).realm.realmId);
    expect(cloud.realms.size).toBe(1);
    expect([...cloud.members.values()]).toHaveLength(2);
    expect([...cloud.members.values()].every((member) => member.owner === null)).toBe(true);
    expect(cloud.requests.filter((item) => item.path === '/my/realms/' + result.realmId)).toHaveLength(2);
    expect(cloud.requests.some((r) => r.path === '/all/members' && r.method === 'POST')).toBe(true);
  });

  it('retries safely without writing over existing memberships', async () => {
    const cloud = fakeCloud();
    await provisionInviteMembership(env, '101', '202', cloud.fetchImpl);
    const writes = cloud.requests.filter((r) => r.method === 'POST'
      && (r.path === '/all/realms' || r.path === '/all/members')).length;
    await provisionInviteMembership(env, '101', '202', cloud.fetchImpl);
    expect(cloud.requests.filter((r) => r.method === 'POST'
      && (r.path === '/all/realms' || r.path === '/all/members'))).toHaveLength(writes);
  });

  it('can resume a partial realm after a failed membership write', async () => {
    const cloud = fakeCloud();
    const plan = await relationshipMembership('101', '202');
    cloud.realms.set(plan.realm.realmId, { ...plan.realm });
    cloud.failOneWrite();
    await expect(provisionInviteMembership(env, '101', '202', cloud.fetchImpl)).rejects.toMatchObject({
      code: 'CLOUD_MEMBERSHIP_UNAVAILABLE',
    });
    const result = await provisionInviteMembership(env, '101', '202', cloud.fetchImpl);
    expect(result.realmId).toBe(plan.realm.realmId);
    expect(cloud.members.size).toBe(2);
  });

  it('refuses privilege escalation through pre-existing self-owned membership', async () => {
    const cloud = fakeCloud();
    const plan = await relationshipMembership('101', '202');
    cloud.realms.set(plan.realm.realmId, { ...plan.realm });
    cloud.members.set(plan.members[1].id, { ...plan.members[1], owner: 'tg:202' });
    await expect(provisionInviteMembership(env, '101', '202', cloud.fetchImpl)).rejects.toMatchObject({
      code: 'CLOUD_MEMBERSHIP_CONFLICT',
    });
    expect(cloud.requests.some((r) => r.method === 'POST' && r.path === '/all/members')).toBe(false);
  });

  it('accepts legacy Coach headers-only policy while rolling out phase permissions', async () => {
    const cloud = fakeCloud();
    Object.assign(cloud.installedRoles[0].permissions, { manage: ['trainingPlans'] });
    await expect(provisionInviteMembership(env, '101', '202', cloud.fetchImpl))
      .resolves.toMatchObject({ realmId: expect.any(String) });
    expect(cloud.members.size).toBe(2);
    Object.assign(cloud.installedRoles[0].permissions, {
      manage: ['trainingPlans', 'programPhases', 'programDays'],
    });
    await expect(provisionInviteMembership(env, '101', '203', cloud.fetchImpl))
      .rejects.toMatchObject({ code: 'CLOUD_MEMBERSHIP_UNAVAILABLE' });
  });

  it('accepts the exact previously deployed phase policy during descendant rollout', async () => {
    const cloud = fakeCloud();
    Object.assign(cloud.installedRoles[0].permissions, { manage: ['trainingPlans', 'programPhases'] });
    await expect(provisionInviteMembership(env, '101', '202', cloud.fetchImpl))
      .resolves.toMatchObject({ realmId: expect.any(String) });
  });

  it('fails closed on a drifted global role policy', async () => {
    const cloud = fakeCloud();
    cloud.installedRoles[1].permissions.update.sessionSetFacts.push('owner');
    await expect(provisionInviteMembership(env, '101', '202', cloud.fetchImpl)).rejects.toMatchObject({
      code: 'CLOUD_MEMBERSHIP_UNAVAILABLE',
    });
    expect(cloud.realms.size).toBe(0);
  });

  it('does not leak credentials or response bodies on upstream failures', async () => {
    const cloud = fakeCloud();
    const failing = vi.fn<typeof fetch>(async (request, init) => {
      if (String(request).endsWith('/token')) {
        return new Response('secret inside error', { status: 403 });
      }
      return cloud.fetchImpl(request, init);
    });
    await expect(provisionInviteMembership(env, '101', '202', failing)).rejects.toMatchObject({
      code: 'CLOUD_MEMBERSHIP_UNAVAILABLE',
      status: 502,
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
