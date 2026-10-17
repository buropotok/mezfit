import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  assertRolePolicy,
  provisionRelationship,
  relationshipPlan,
  telegramUserId,
} from './dexie-cloud-relationship.mjs';

const dbUrl = 'https://zjv60oxag.dexie.cloud';
const credentials = { clientId: 'private-admin-id', clientSecret: 'private-admin-secret' };
const localRoles = JSON.parse(readFileSync(
  new URL('../cloud/roles.json', import.meta.url), 'utf8',
)).roles;

function createServer() {
  const realms = new Map();
  const members = new Map();
  const calls = [];
  const remoteRoles = ['coach', 'client'].map((name) => ({
    realmId: 'rlm-public', name, permissions: structuredClone(localRoles[name].permissions),
  }));
  const realmRoles = [];
  let failMembersOnce = false;
  let grantGlobal = true;
  let grantImpersonation = true;

  const fetchImpl = vi.fn(async (resource, init = {}) => {
    const url = new URL(resource);
    const path = url.pathname;
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const bearer = init.headers?.Authorization?.replace('Bearer ', '');
    calls.push({ path, method, scopes: path === '/token' ? body.scopes : undefined,
      claims: path === '/token' ? body.claims : undefined, bearer });

    if (path === '/token' && method === 'POST') {
      if (body.client_id !== credentials.clientId
        || body.client_secret !== credentials.clientSecret) {
        return Response.json({ error: 'invalid_credentials' }, { status: 401 });
      }
      if ((body.scopes.includes('GLOBAL_WRITE') && !grantGlobal)
        || (body.claims && !grantImpersonation)) {
        return Response.json({ error: 'scope_denied' }, { status: 403 });
      }
      return Response.json({
        type: 'tokens', accessToken: body.claims ? 'user:' + body.claims.sub : 'admin',
        claims: body.claims ?? { sub: 'service' },
      });
    }

    if (path === '/public/roles' && method === 'GET') {
      return Response.json(remoteRoles);
    }

    if (bearer !== 'admin' && !(bearer?.startsWith('user:'))) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (path.startsWith('/all/realms/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/all/realms/'.length));
      return realms.has(id) ? Response.json(realms.get(id))
        : Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (path === '/all/roles' && method === 'GET') {
      const realmId = url.searchParams.get('realmId');
      return Response.json(realmRoles.filter((role) => role.realmId === realmId));
    }
    if (path === '/all/members' && method === 'GET') {
      const realmId = url.searchParams.get('realmId');
      return Response.json([...members.values()].filter((value) => value.realmId === realmId));
    }
    if (path === '/all/realms' && method === 'POST') {
      if (bearer !== 'admin') return Response.json({}, { status: 403 });
      for (const row of body) realms.set(row.realmId, structuredClone(row));
      return Response.json({ ok: true });
    }
    if (path === '/all/members' && method === 'POST') {
      if (bearer !== 'admin') return Response.json({}, { status: 403 });
      if (failMembersOnce) {
        failMembersOnce = false;
        return Response.json({ error: 'temporary_failure' }, { status: 503 });
      }
      for (const row of body) members.set(row.id, {
        ...structuredClone(row), accepted: { $t: 'Date', v: '2026-10-12T00:00:00Z' },
      });
      return Response.json({ ok: true });
    }
    if (path.startsWith('/my/realms/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/my/realms/'.length));
      const userId = bearer.slice('user:'.length);
      const belongs = [...members.values()].some((m) => m.realmId === id && m.userId === userId);
      if (!belongs || !realms.has(id)) return Response.json({}, { status: 404 });
      return Response.json(realms.get(id));
    }
    throw new Error('Unexpected simulated Dexie endpoint: ' + method + ' ' + path);
  });

  return {
    fetchImpl, calls, realms, members, remoteRoles, realmRoles,
    failNextMemberWrite: () => { failMembersOnce = true; },
    disableGlobalWrite: () => { grantGlobal = false; },
    disableImpersonation: () => { grantImpersonation = false; },
  };
}

function operation(server, apply = true) {
  return provisionRelationship({
    dbUrl, credentials, coachId: '101', clientId: '202',
    fetchImpl: server.fetchImpl, localRoles, apply,
  });
}

describe('relationship bootstrap identity', () => {
  it('generates stable, globally-prefixed IDs distinct by coach/client order', () => {
    const first = relationshipPlan('101', '202');
    expect(first).toEqual(relationshipPlan('101', '202'));
    expect(first.realm.realmId).toMatch(/^rlm[a-f0-9]{28}$/);
    expect(first.realm.owner).toBeNull();
    expect(first.members.map((m) => m.id)).toEqual([
      expect.stringMatching(/^mmb[a-f0-9]{28}$/),
      expect.stringMatching(/^mmb[a-f0-9]{28}$/),
    ]);
    expect(first.members.every((member) => member.owner === null)).toBe(true);
    expect(first.members[0].roles).toEqual(['coach']);
    expect(first.members[1].roles).toEqual(['client']);
    expect(first.members.every((m) => m.invite === false && m.accepted === true)).toBe(true);
    expect(relationshipPlan('202', '101').realm.realmId).not.toBe(first.realm.realmId);
  });

  it('rejects self-relations and invalid or unsafe Telegram identities', () => {
    for (const input of ['0', '-1', '1.2', 'tg:1', '01', '9007199254740992', '']) {
      expect(() => telegramUserId(input)).toThrow('INVALID_TELEGRAM_ID');
    }
    expect(() => relationshipPlan('101', '101')).toThrow('SELF_RELATIONSHIP_FORBIDDEN');
  });

  it('runs the actual CLI dry-run from outside the repository with checked-in config', () => {
    const script = fileURLToPath(new URL('./dexie-cloud-relationship.mjs', import.meta.url));
    const outsideRepository = fileURLToPath(new URL('../../', import.meta.url));
    const result = spawnSync(process.execPath, [
      script, '--coach', '101', '--client', '202',
    ], {
      cwd: outsideRepository,
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      realmId: relationshipPlan('101', '202').realm.realmId,
      applied: false,
    });
  });

  it('does not access remote services or require a key in dry-run', async () => {
    const server = createServer();
    const result = await provisionRelationship({
      dbUrl, coachId: '101', clientId: '202', fetchImpl: server.fetchImpl,
      apply: false,
    });
    expect(result).toEqual({
      realmId: relationshipPlan('101', '202').realm.realmId, applied: false,
    });
    expect(server.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('administrative Dexie relationship provisioning', () => {
  it('validates global role policy then provisions ownerless realm and two least-privileged members', async () => {
    const server = createServer();
    const result = await operation(server);

    expect(result).toEqual({
      realmId: relationshipPlan('101', '202').realm.realmId,
      applied: true, membersVerified: 2,
    });
    expect([...server.realms.values()]).toEqual([relationshipPlan('101', '202').realm]);
    expect([...server.members.values()].map(({ id, realmId, userId, roles, invite }) => ({
      id, realmId, userId, roles, invite,
    }))).toEqual(relationshipPlan('101', '202').members.map(
      ({ id, realmId, userId, roles, invite }) => ({ id, realmId, userId, roles, invite }),
    ));
    expect(server.calls.filter((call) => call.method === 'POST' && call.path === '/token')
      .map((call) => ({ scopes: call.scopes, claims: call.claims }))).toEqual([
      { scopes: ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE'], claims: undefined },
      { scopes: ['ACCESS_DB'], claims: { sub: 'tg:101' } },
      { scopes: ['ACCESS_DB'], claims: { sub: 'tg:202' } },
    ]);
    expect(server.calls.filter((call) => call.method === 'POST' && call.path !== '/token')
      .map((call) => call.path)).toEqual(['/all/realms', '/all/members']);
  });

  it('is idempotent: never overwrites the realm or an already accepted member', async () => {
    const server = createServer();
    await operation(server);
    server.calls.length = 0;
    await operation(server);
    expect(server.calls.filter((call) => call.method === 'POST'
      && call.path !== '/token')).toEqual([]);
    expect(server.members.size).toBe(2);
    expect(server.realms.size).toBe(1);
    expect([...server.members.values()].every((member) => member.owner === null)).toBe(true);
  });

  it('resumes after partial failure without creating duplicate memberships', async () => {
    const server = createServer();
    server.failNextMemberWrite();
    await expect(operation(server)).rejects.toThrow('DEXIE_WRITE_MEMBERS_HTTP_503');
    expect(server.realms.size).toBe(1);
    expect(server.members.size).toBe(0);

    await operation(server);
    expect(server.realms.size).toBe(1);
    expect(server.members.size).toBe(2);
    expect([...server.members.values()].every((member) => member.owner === null)).toBe(true);
  });

  it('resumes a partially provisioned pair by writing only the missing member', async () => {
    const server = createServer();
    const plan = relationshipPlan('101', '202');
    server.realms.set(plan.realm.realmId, plan.realm);
    server.members.set(plan.members[0].id, {
      ...plan.members[0], accepted: { $t: 'Date', v: '2026-10-12T00:00:00Z' },
    });
    await operation(server);
    const posts = server.calls.filter((call) => call.method === 'POST'
      && call.path !== '/token');
    expect(posts.map((call) => call.path)).toEqual(['/all/members']);
    expect(server.members.size).toBe(2);
  });

  it('rejects an existing realm with an owner rather than mutating permissions', async () => {
    const server = createServer();
    const { realm } = relationshipPlan('101', '202');
    server.realms.set(realm.realmId, { ...realm, owner: 'tg:unrelated' });

    await expect(operation(server)).rejects.toThrow('REALM_OWNERSHIP_OR_IDENTITY_CONFLICT');
    expect(server.calls.filter((call) => call.path === '/all/realms'
      && call.method === 'POST')).toEqual([]);
  });

  it('rejects self-owned or ownerless-unknown existing membership before mutations', async () => {
    for (const owner of ['tg:202', 'tg:101', undefined]) {
      const server = createServer();
      const plan = relationshipPlan('101', '202');
      server.realms.set(plan.realm.realmId, plan.realm);
      server.members.set(plan.members[1].id, { ...plan.members[1], owner });

      await expect(operation(server)).rejects.toThrow('MEMBER_IDENTITY_OR_PERMISSIONS_CONFLICT');
      expect(server.calls.filter((call) => call.method === 'POST'
        && (call.path === '/all/realms' || call.path === '/all/members'))).toEqual([]);
    }
  });

  it('rejects extra members and unexpected direct permissions without modifying them', async () => {
    const server = createServer();
    const plan = relationshipPlan('101', '202');
    server.realms.set(plan.realm.realmId, plan.realm);
    server.members.set('mmbunrelated', {
      id: 'mmbunrelated', realmId: plan.realm.realmId, userId: 'tg:333',
      roles: ['client'], invite: false, accepted: true,
    });
    await expect(operation(server)).rejects.toThrow('MEMBER_IDENTITY_OR_PERMISSIONS_CONFLICT');

    server.members.clear();
    server.members.set(plan.members[0].id, {
      ...plan.members[0], permissions: { manage: '*' },
    });
    await expect(operation(server)).rejects.toThrow('MEMBER_IDENTITY_OR_PERMISSIONS_CONFLICT');
    expect(server.calls.filter((call) => call.path === '/all/members'
      && call.method === 'POST')).toEqual([]);
  });

  it('fails closed when installed client permissions drift from the source-of-truth roles', async () => {
    const server = createServer();
    server.remoteRoles.find((r) => r.name === 'client').permissions.manage = '*';
    await expect(operation(server)).rejects.toThrow('CLOUD_ROLE_MISMATCH');
    expect(server.realms.size).toBe(0);
    expect(server.members.size).toBe(0);
  });

  it('rejects realm-local roles that could shadow the global coach/client policies', async () => {
    const server = createServer();
    const plan = relationshipPlan('101', '202');
    server.realmRoles.push({
      realmId: plan.realm.realmId,
      name: 'client',
      permissions: { manage: '*' },
    });
    await expect(operation(server)).rejects.toThrow('REALM_LOCAL_ROLE_OVERRIDES_FORBIDDEN');
    expect(server.realms.size).toBe(0);
    expect(server.members.size).toBe(0);
  });

  it('fails before any realm mutation if admin lacks GLOBAL_WRITE', async () => {
    const server = createServer();
    server.disableGlobalWrite();
    await expect(operation(server)).rejects.toThrow('DEXIE_TOKEN_HTTP_403');
    expect(server.realms.size).toBe(0);
    expect(server.members.size).toBe(0);
  });

  it('preflights IMPERSONATE before any realm/member writes', async () => {
    const server = createServer();
    server.disableImpersonation();
    await expect(operation(server)).rejects.toThrow('DEXIE_TOKEN_HTTP_403');
    expect(server.realms.size).toBe(0);
    expect(server.members.size).toBe(0);
  });

  it('does not expose privileged credentials or tokens in error messages', async () => {
    const server = createServer();
    server.disableGlobalWrite();
    let failure = '';
    try {
      await operation(server);
    } catch (error) {
      failure = String(error);
    }
    expect(failure).not.toContain(credentials.clientId);
    expect(failure).not.toContain(credentials.clientSecret);
    expect(failure).not.toContain('user:tg:');
  });

  it('rejects unknown schema and inaccessible scoped realm rather than reporting success', async () => {
    const server = createServer();
    const original = server.fetchImpl;
    const unavailableSchema = vi.fn(async (url, init) =>
      new URL(url).pathname === '/all/members' ? Response.json({}, { status: 404 })
        : original(url, init));
    await expect(provisionRelationship({
      dbUrl, credentials, coachId: '101', clientId: '202',
      localRoles, fetchImpl: unavailableSchema, apply: true,
    })).rejects.toThrow('DEXIE_LIST_MEMBERS_HTTP_404');
    expect(server.realms.size).toBe(0);
  });
});

describe('installed role policy guard', () => {
  it('accepts all three exact rollout policies and rejects extra Coach grants', () => {
    const remote = ['coach', 'client'].map((name) => ({
      realmId: 'rlm-public', name, permissions: structuredClone(localRoles[name].permissions),
    }));
    for (const manage of [
      ['trainingPlans'],
      ['trainingPlans', 'programPhases'],
      ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets'],
    ]) {
      remote[0].permissions.manage = manage;
      expect(() => assertRolePolicy(remote, localRoles)).not.toThrow();
    }
    remote[0].permissions.manage.push('workoutSessions');
    expect(() => assertRolePolicy(remote, localRoles)).toThrow('CLOUD_ROLE_MISMATCH');
  });

  it('permits only the exact legacy and upgraded Coach ACL during staged rollout', () => {
    const previous = ['coach', 'client'].map((name) => ({
      realmId: 'rlm-public', name,
      permissions: structuredClone(localRoles[name].permissions),
    }));
    previous[0].permissions.manage = ['trainingPlans'];
    expect(() => assertRolePolicy(previous, localRoles)).not.toThrow();
    previous[0].permissions.manage = ['trainingPlans', 'programPhases', 'programDays'];
    expect(() => assertRolePolicy(previous, localRoles)).toThrow('CLOUD_ROLE_MISMATCH');
  });

  it('accepts only the intended coach and client permissions', () => {
    const remote = ['coach', 'client'].map((name) => ({
      realmId: 'rlm-public', name, permissions: localRoles[name].permissions,
    }));
    expect(() => assertRolePolicy(remote, localRoles)).not.toThrow();
    remote[1].permissions = { update: { sessionSetFacts: ['actualReps', 'owner'] } };
    expect(() => assertRolePolicy(remote, localRoles)).toThrow('CLOUD_ROLE_MISMATCH');
    const localDrift = structuredClone(localRoles);
    localDrift.coach.permissions.manage = ['members'];
    expect(() => assertRolePolicy(['coach', 'client'].map((name) => ({
      realmId: 'rlm-public', name, permissions: localRoles[name].permissions,
    })), localDrift)).toThrow('CLOUD_ROLE_MISMATCH');
  });
});
