import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { ProgramManagementRepository } from './program-management';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

async function fixture() {
  // Real Dexie liveQuery and real WebCrypto, with an in-memory IndexedDB API.
  // No Cloud Addon/network: this regression concerns local observation only.
  const db = new Dexie(`phase-observation-${crypto.randomUUID()}`, { addons: [] });
  databases.push(db);
  db.version(1).stores({
    trainingPlans: 'id, realmId',
    programPhases: 'id, realmId, trainingPlanId',
    realms: 'realmId',
    members: 'id, realmId',
  });
  db.table('programPhases').hook('creating', () => crypto.randomUUID());
  const pair = await relationshipMembership('101', '202');
  const plan: CloudTrainingPlanRow = {
    id: 'plan', realmId: pair.realm.realmId, owner: 'tg:101',
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
    name: 'Программа', position: 0, status: 'active',
    startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
  };
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('trainingPlans').add(plan);
  const database = db as unknown as MezfitCloudDatabase;
  return {
    db,
    coach: new ProgramManagementRepository(database, 'tg:101'),
    client: new ProgramManagementRepository(database, 'tg:202'),
  };
}

describe('assigned phase observation across WebCrypto authorization', () => {
  it('emits a newly created and renamed phase without reopening the program', async () => {
    const { db, coach } = await fixture();
    const next = vi.fn();
    const error = vi.fn();
    const subscription = coach.observeDetails('plan', next, error);
    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalled());
      expect(next.mock.lastCall?.[0]?.phases).toEqual([]);
      const id = await coach.createPhase('plan');
      expect(await db.table('programPhases').count()).toBe(1);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.phases).toHaveLength(1));
      await coach.renamePhase('plan', id, 'Новое название');
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.phases[0].name).toBe('Новое название'));
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });

  it('shows a published phase to the client without exposing its draft', async () => {
    const { coach, client } = await fixture();
    const next = vi.fn();
    const error = vi.fn();
    const subscription = client.observeActiveForAthlete('tg:202', 'tg:101', next, error);
    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalled());
      const id = await coach.createPhase('plan');
      expect((await client.details('plan'))?.phases[0].status).toBe('draft');
      expect(next.mock.lastCall?.[0]?.phases).toEqual([]);
      await coach.publishPhase('plan', id);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.phases[0]?.status).toBe('pending'));
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });
});
