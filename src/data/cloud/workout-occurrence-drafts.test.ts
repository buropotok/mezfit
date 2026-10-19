import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayOutline } from './workout-foundation-types';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { draftFromProgramDay } from './workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';

const opened: Dexie[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});
let db: Dexie;
beforeEach(() => {
  db = new Dexie('occurrence-drafts-' + crypto.randomUUID());
  db.version(1).stores({
    localWorkoutOccurrenceDrafts: 'id, actorUserId, startsAtUtc, programDayId, updatedAt',
    workoutOccurrences: 'id, realmId', localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId',
  });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (!key) { row.id = 'occ' + crypto.randomUUID().replaceAll('-', ''); return row.id; }
  });
  opened.push(db);
});
const program: CloudTrainingPlanRow = {
  id: 'plan-one', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, name: 'Program', position: 0, status: 'active',
  startedAt: null, finishedAt: null, createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:00:00.000Z',
};
const outline: CloudProgramDayOutline = {
  day: { id: 'day-one', programPhaseId: 'phase', realmId: 'tg:101',
    owner: 'tg:101', name: 'День А', comment: null, status: 'active', position: 0 },
  exercises: [{
    exercise: { id: 'ex-one', realmId: 'tg:101', owner: 'tg:101',
      programDayId: 'day-one', position: 0, notes: null, status: 'active',
      exercise: { exerciseDefinitionId: '0001', scope: 'public',
        name: 'Приседания', nameEn: null, mediaUrl: null } },
    sets: [{ id: 'set-one', realmId: 'tg:101', owner: 'tg:101',
      programExerciseId: 'ex-one', position: 0, status: 'active',
      plannedReps: null, plannedWeightKg: null, plannedDurationSeconds: null,
      plannedDistanceMeters: null }],
  }],
};
const repo = (user = 'tg:101') => new WorkoutOccurrenceDraftRepository(db as unknown as MezfitCloudDatabase, user);
const make = () => draftFromProgramDay('tg:101', program, outline, 'independent',
  '2026-10-19T08:00:00.000Z', 60, 'active');

describe('local workout occurrence drafts', () => {
  it('saves, reopens, edits content and timing, and saves again without contacting the cloud', async () => {
    const store = repo(), draft = make();
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    try {
      await store.create(draft);
      const id = await store.save(draft.id);
      expect(await store.list()).toEqual([]);
      let saved = await store.get('draft:' + id);
      expect(saved?.saved).toBe(true);
      // Recreate the repository and reopen the actual IndexedDB connection.
      db.close(); await db.open();
      expect((await repo().get('draft:' + id))?.plan).toEqual(draft.plan);
      await repo().enqueueEdit('draft:' + id, row => ({ ...row, durationMinutes: 90 }));
      expect(await repo().list()).toEqual([]);
      expect((await repo().get('draft:' + id))?.durationMinutes).toBe(90);
      await repo().replacePlan('draft:' + id, { ...draft.plan, name: 'Изменённый день' });
      expect((await repo().list())[0].saved).toBe(false);
      expect((await db.table('workoutOccurrences').get(id)).plan.name).toBe(draft.plan.name);
      await repo().enqueueEdit('draft:' + id, row => ({ ...row, startsAtUtc: '2026-10-20T09:00:00.000Z' }));
      expect((await db.table('workoutOccurrences').get(id)).startsAtUtc).toBe('2026-10-20T09:00:00.000Z');
      expect((await repo().list())[0].saved).toBe(false);
      expect(await repo().save('draft:' + id)).toBe(id);
      saved = await repo().get('draft:' + id);
      expect(saved?.saved).toBe(true);
      expect(saved?.plan.name).toBe('Изменённый день');
      expect(await db.table('workoutOccurrences').count()).toBe(1);
      expect((await db.table('localWorkoutSync').get(id)).confirmed).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects overlapping local intervals and rolls back without losing the draft', async () => {
    const first = make(), second = make();
    await repo().create(first);
    await expect(repo().create(second)).rejects.toThrow(/время занято/);
    const id = await repo().save(first.id);
    const later = { ...second, startsAtUtc: '2026-10-19T10:00:00.000Z' };
    await repo().create(later);
    await expect(repo().enqueueEdit(later.id, row => ({ ...row, startsAtUtc: first.startsAtUtc }))).rejects.toThrow(/время занято/);
    expect((await repo().get(later.id))?.startsAtUtc).toBe(later.startsAtUtc);
    expect((await repo().get('draft:' + id))?.saved).toBe(true);
    await repo().enqueueEdit(later.id, row => ({ ...row, startsAtUtc: '2026-10-19T11:00:00.000Z' }));
    expect((await repo().get(later.id))?.startsAtUtc).toBe('2026-10-19T11:00:00.000Z');
  });

  it('cancels a saved workout locally and does not require a confirmation receipt', async () => {
    const draft = make(); await repo().create(draft);
    const id = await repo().save(draft.id);
    await repo().cancel(id);
    expect((await db.table('workoutOccurrences').get(id)).status).toBe('cancelled');
    expect(await repo().get('draft:' + id)).toBeNull();
  });

  it('keeps private coach content out of the client view while timing edits stay local-first', async () => {
    const pair = await relationshipMembership('101', '202');
    await db.table('realms').put(pair.realm); await db.table('members').bulkAdd(pair.members);
    const shared = { ...make(), realmId: pair.realm.realmId, athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202' };
    await repo().create(shared); const id = await repo().save(shared.id);
    await repo().replacePlan('draft:' + id, { ...shared.plan, name: 'Новый план тренера' });
    expect((await repo('tg:202').get('draft:' + id))?.plan.name).toBe(shared.plan.name);
    await repo('tg:202').enqueueEdit('draft:' + id, current => ({ ...current, durationMinutes: 90 }));
    expect((await db.table('workoutOccurrences').get(id)).durationMinutes).toBe(90);
    const update = vi.spyOn(db.table('workoutOccurrences'), 'update');
    await repo('tg:202').save('draft:' + id);
    expect(update.mock.calls.at(-1)?.[1]).not.toHaveProperty('plan');
    update.mockRestore();
    await expect(repo('tg:202').replacePlan('draft:' + id, { ...shared.plan, name: 'Подмена' }))
      .rejects.toThrow('SCHEDULE_PLAN_FORBIDDEN');
    expect((await repo().get('draft:' + id))?.plan.name).toBe('Новый план тренера');
    expect(await repo('tg:303').get('draft:' + id)).toBeNull();
  });

  it('retains a failed write across repository/editor recreation and isolates accounts', async () => {
    const first = repo(), draft = make();
    await first.create(draft);
    const failure = vi.spyOn(first, 'edit').mockRejectedValueOnce(new Error('Нет места'));
    await expect(first.enqueueEdit(draft.id, current => ({ ...current, durationMinutes: 90 })))
      .rejects.toThrow('Нет места');
    failure.mockRestore();
    expect(repo('tg:202').pendingEditError(draft.id)).toBe('');
    expect(repo().pendingEditError(draft.id)).toBe('Нет места');
    await repo().flushEdits(draft.id);
    expect((await repo().get(draft.id))?.durationMinutes).toBe(90);
    expect(repo().pendingEditError(draft.id)).toBe('');
  });

  it('allows explicit deletion to discard a failed intent', async () => {
    const store = repo(), draft = make();
    await store.create(draft);
    const failure = vi.spyOn(store, 'edit').mockRejectedValueOnce(new Error('Нет места'));
    await expect(store.enqueueEdit(draft.id, current => ({ ...current, durationMinutes: 90 })))
      .rejects.toThrow('Нет места');
    failure.mockRestore();
    await store.delete(draft.id);
    expect(await repo().get(draft.id)).toBeNull();
    expect(repo().pendingEditError(draft.id)).toBe('');
  });

  it.each(['draft', 'pending', 'finished', 'cancelled'] as const)('checks phase %s locally at creation only', async status => {
    expect(() => draftFromProgramDay('tg:101', program, outline, 'independent',
      '2026-10-19T08:00:00.000Z', 60, status)).toThrow('SCHEDULE_FORBIDDEN');
    const store = repo(), accepted = make();
    await store.create(accepted);
    // The accepted draft is independent; source state is not re-read on edit/get.
    await store.edit(accepted.id, current => ({ ...current, durationMinutes: 90 }));
    expect((await store.get(accepted.id))?.durationMinutes).toBe(90);
  });
  it.each(['draft', 'finished', 'cancelled'] as const)('checks program %s locally at creation', status => {
    expect(() => draftFromProgramDay('tg:101', { ...program, status }, outline, 'independent',
      '2026-10-19T08:00:00.000Z', 60, 'active')).toThrow('SCHEDULE_FORBIDDEN');
  });

  it('persists a complete independent PLAN after closing the editor and reopening the database', async () => {
    const first = repo(), draft = make();
    await first.create(draft);
    expect(draft.plan.exercises[0].sets[0].plannedReps).toBeNull();
    await first.edit(draft.id, current => ({
      ...current, startsAtUtc: '2026-10-20T10:00:00.000Z',
      plan: { ...current.plan, exercises: [...current.plan.exercises, {
        ...current.plan.exercises[0], id: 'copied-exercise', position: 1, sets: [],
      }] },
    }));
    const restored = await repo().get(draft.id);
    expect(restored?.startsAtUtc).toBe('2026-10-20T10:00:00.000Z');
    expect(restored?.plan.exercises).toHaveLength(2);
    expect(restored?.originalPlan.exercises).toHaveLength(1);
    expect(restored?.updatedAt).toBeTruthy();
    expect(await repo('tg:202').get(draft.id)).toBeNull();
  });

  it('rejects invalid timing without discarding saved work', async () => {
    const store = repo(), draft = make();
    await store.create(draft);
    await expect(store.edit(draft.id, current =>
      ({ ...current, durationMinutes: -1 }))).rejects.toThrow('INVALID_SCHEDULE_DURATION');
    expect((await store.get(draft.id))?.durationMinutes).toBe(60);
  });

  it('deletes only the explicitly selected draft', async () => {
    const store = repo(), a = make(), b = { ...make(), startsAtUtc: '2026-10-20T08:00:00.000Z' };
    await store.create(a); await store.create(b);
    expect(await store.list()).toHaveLength(2);
    await store.delete(a.id);
    expect((await store.list()).map(row => row.id)).toEqual([b.id]);
  });
});
