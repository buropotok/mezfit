import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

async function fixture() {
  const db = new Dexie('adhoc-regressions-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id' });
  for (const table of ['adHocSessions', 'trainingPlans', 'programPhases', 'programDays'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').put({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  const database = db as MezfitCloudDatabase;
  return { db, database, pair, repo: new AdHocWorkoutRepository(database, 'tg:101') };
}

describe('one active ad-hoc session per creator', () => {
  it('serializes competing quick and programme starts across repository instances', async () => {
    const { db, database, repo } = await fixture();
    const other = new AdHocWorkoutRepository(database, 'tg:101');
    const results = await Promise.allSettled([repo.createQuick(), other.createForAthlete('tg:202')]);
    const successes = results.filter(result => result.status === 'fulfilled');
    const failures = results.filter(result => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (failures[0].status === 'rejected') expect(failures[0].reason.message).toBe('ADHOC_ACTIVE_SESSION_EXISTS');
    expect(await db.table('adHocSessions').count()).toBe(1);
    const active = await repo.getActive();
    expect(active?.id).toBe(successes[0].status === 'fulfilled' ? successes[0].value.id : undefined);
    if (!active) throw new Error('Missing active session');
    const before = await db.table('adHocSessions').get(active.id);
    const counts = await Promise.all(['trainingPlans', 'programPhases', 'programDays'].map(table => db.table(table).count()));
    await expect(other.createQuick()).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    await expect(other.createForAthlete('tg:101')).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    expect(await db.table('adHocSessions').get(active.id)).toEqual(before);
    expect(await Promise.all(['trainingPlans', 'programPhases', 'programDays'].map(table => db.table(table).count()))).toEqual(counts);
  });

  it('blocks personal and other client starts while the creator has an active client session', async () => {
    const { repo, database } = await fixture();
    const first = await repo.createForAthlete('tg:202');
    expect(await repo.getActive()).toEqual({ id: first.id, name: 'Тренировка' });
    await expect(repo.createQuick()).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    await expect(repo.createForAthlete('tg:303')).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    // A readable session created by the coach does not occupy the client's slot.
    const client = new AdHocWorkoutRepository(database, 'tg:202');
    expect(await client.getActive()).toBeNull();
    expect(await client.get(first.id)).not.toBeNull();
    const personal = await client.createQuick();
    expect((await client.getActive())?.id).toBe(personal.id);
  });

  it('restores active status after reopen and permits a new start while a template choice is pending', async () => {
    const { db, database, repo } = await fixture();
    const first = await repo.createForAthlete('tg:101');
    db.close(); await db.open();
    const reopened = new AdHocWorkoutRepository(database, 'tg:101');
    expect((await reopened.getActive())?.id).toBe(first.id);
    const next = vi.fn(), error = vi.fn();
    const subscription = reopened.observeOpen(next, error);
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual([
        { id: first.id, name: 'Тренировка', status: 'active' },
      ]));
      await reopened.complete(first.id);
      expect(await reopened.getActive()).toBeNull();
      expect((await reopened.getRow(first.id))?.templateSaveDecision).toBe('pending');
      const second = await reopened.createQuick();
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual(expect.arrayContaining([
        { id: first.id, name: 'Тренировка', status: 'completed' },
        { id: second.id, name: 'Тренировка', status: 'active' },
      ])));
      expect((await reopened.getActive())?.id).toBe(second.id);
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });

  it('does not block on revoked relationships or malformed synchronized rows', async () => {
    const { db, pair, repo } = await fixture();
    const shared = await repo.createForAthlete('tg:202');
    await db.table('members').delete(pair.members[1].id);
    expect(await repo.getActive()).toBeNull();
    const personal = await repo.createQuick();
    await db.table('adHocSessions').update(personal.id, { owner: 'tg:303' });
    expect(await repo.getActive()).toBeNull();
    const next = await repo.createQuick();
    expect((await repo.getActive())?.id).toBe(next.id);
    // Neither inaccessible record is deleted or rewritten by the guard.
    expect(await db.table('adHocSessions').count()).toBe(3);
    expect(await repo.get(shared.id)).toBeNull();
  });
});


describe('safe unavailable-session diagnostics', () => {
  it('distinguishes missing records, invalid source and invalid ownership without exposing rejected data', async () => {
    const { database, repo } = await fixture();
    const created = await repo.createQuick();
    const original = await database.adHocSessions.get(created.id);
    if (!original) throw new Error('Missing fixture');
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observe(created.id, next, error);
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.sessionId).toBe(created.id));
      await database.adHocSessions.update(created.id, { programId: 'program', programName: null });
      await vi.waitFor(() => expect(next.mock.lastCall).toEqual([null, undefined, 'ADHOC_INVALID_SOURCE']));
      expect(await repo.get(created.id)).toBeNull();
      await database.adHocSessions.put({ ...original, owner: 'tg:303' });
      await vi.waitFor(() => expect(next.mock.lastCall).toEqual([null, undefined, 'ADHOC_INVALID_IDENTITY']));
      expect(await repo.getRow(created.id)).toBeNull();
      await database.adHocSessions.put(original);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.sessionId).toBe(created.id));
      await database.adHocSessions.delete(created.id);
      await vi.waitFor(() => expect(next.mock.lastCall).toEqual([null, undefined, 'ADHOC_LOCAL_RECORD_MISSING']));
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });

  it('reports revoked relationship access and keeps its header and exercises hidden', async () => {
    const { database, pair, repo } = await fixture();
    const created = await repo.createForAthlete('tg:202');
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observe(created.id, next, error);
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.sessionId).toBe(created.id));
      await database.members.delete(pair.members[1].id);
      await vi.waitFor(() => expect(next.mock.lastCall).toEqual([null, undefined, 'ADHOC_RELATIONSHIP_UNAVAILABLE']));
      expect(await repo.getRow(created.id)).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });
});
