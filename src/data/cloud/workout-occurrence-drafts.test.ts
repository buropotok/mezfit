import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayOutline } from './workout-foundation-types';
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
    const store = repo(), a = make(), b = make();
    await store.create(a); await store.create(b);
    expect(await store.list()).toHaveLength(2);
    await store.delete(a.id);
    expect((await store.list()).map(row => row.id)).toEqual([b.id]);
  });
});
