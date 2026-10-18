import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { CloudTrainingPlanRow } from './database';
import type { CloudProgramDayOutline } from './workout-foundation-types';
import { draftFromProgramDay } from './workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';

const opened: WorkoutOccurrenceDraftRepository[] = [];
afterEach(async () => {
  opened.splice(0).forEach(repo => repo.close());
  await Dexie.delete('mezfit-occurrence-drafts:tg:101');
  await Dexie.delete('mezfit-occurrence-drafts:tg:202');
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
const repo = (user = 'tg:101') => {
  const next = new WorkoutOccurrenceDraftRepository(user);
  opened.push(next);
  return next;
};
const make = () => draftFromProgramDay('tg:101', program, outline, 'independent',
  '2026-10-19T08:00:00.000Z', 60);

describe('local workout occurrence drafts', () => {
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
    first.close();
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
