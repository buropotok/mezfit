import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { duplicateWorkoutPlan, isWorkoutRepeatRule, repeatWorkoutStarts } from './workout-recurrence';

const opened: Dexie[] = [];
afterEach(async () => { for (const db of opened.splice(0)) await db.delete(); });

function fixture() {
  const db = new Dexie('workout-recurrence-' + crypto.randomUUID());
  db.version(1).stores({
    workoutOccurrences: 'id, realmId, startsAtUtc',
    realms: 'realmId', members: 'id, realmId', localWorkoutSync: 'id',
  });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (!key) { row.id = crypto.randomUUID(); return row.id; }
  });
  opened.push(db);
  const repo = new WorkoutOccurrenceDraftRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  const startsAtUtc = new Date(2026, 10, 2, 8).toISOString(); // local Monday
  const plan = {
    name: 'Силовая', comment: 'Тренировка А',
    exercises: [{ id: 'exercise-old', sourceProgramExerciseId: null, position: 0, notes: 'PLAN',
      exercise: { exerciseDefinitionId: '0001', scope: 'public' as const, name: 'Жим',
        nameEn: null, mediaUrl: null },
      sets: [{ id: 'set-old', sourceProgramSetId: null, position: 0,
        setType: null, setLabel: null, comment: null, materialLinks: [], chatLinks: [],
        plannedReps: 8, plannedWeightKg: 75, plannedDurationSeconds: null, plannedDistanceMeters: null }],
    }],
  };
  const source: LocalWorkoutOccurrenceDraft = {
    id: 'draft:' + crypto.randomUUID(), actorUserId: 'tg:101', realmId: 'tg:101',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
    startsAtUtc, durationMinutes: 60, plan, originalPlan: structuredClone(plan),
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  };
  return { db, repo, source, startsAtUtc };
}

describe('materialized workout series', () => {
  it('expands weekdays by local calendar dates, keeping the original occurrence', () => {
    const first = new Date(2026, 10, 2, 8).toISOString();
    const starts = repeatWorkoutStarts(first, { weekdays: [1, 3, 5], weeks: 4 });
    expect(starts).toHaveLength(11);
    expect(starts.every(instant => new Date(instant).getHours() === 8)).toBe(true);
    expect(starts.every(instant => [1, 3, 5].includes(new Date(instant).getDay()))).toBe(true);
    expect(starts).not.toContain(first);
    expect(isWorkoutRepeatRule({ weekdays: [1, 1], weeks: 4 })).toBe(false);
    expect(() => repeatWorkoutStarts(first, { weekdays: [], weeks: 4 })).toThrow();
  });

  it('publishes immutable PLAN copies and remembers the selected repeat schedule', async () => {
    const { db, repo, source } = fixture();
    const id = (await repo.create(source, { published: true })).slice(6);
    const rule = { weekdays: [1], weeks: 2 } as const;
    expect(await repo.createRepeats(id, { weekdays: [...rule.weekdays], weeks: rule.weeks })).toBe(1);
    const rows = await db.table('workoutOccurrences').toArray();
    expect(rows).toHaveLength(2);
    const root = rows.find(row => row.id === id)!;
    const copy = rows.find(row => row.id !== id)!;
    expect(copy.repeatSourceId).toBe(id);
    expect(copy.publicationStatus).toBe('published');
    expect(copy.plan.exercises[0].id).not.toBe(root.plan.exercises[0].id);
    expect(copy.plan.exercises[0].sets[0].id).not.toBe(root.plan.exercises[0].sets[0].id);
    expect(copy.plan.exercises[0].sets[0].plannedWeightKg).toBe(75);
    expect(copy.plan).toEqual(copy.originalPlan);
    expect(await repo.repeatRuleFor(id)).toEqual({ weekdays: [1], weeks: 2 });
    await expect(repo.createRepeats(id, { weekdays: [1], weeks: 2 }))
      .rejects.toThrow('уже создана серия');
  });

  it('rolls back all planned repeats on an occupied slot', async () => {
    const { db, repo, source, startsAtUtc } = fixture();
    const id = (await repo.create(source, { published: true })).slice(6);
    await repo.create({ ...source, id: 'draft:' + crypto.randomUUID(),
      startsAtUtc: new Date(2026, 10, 4, 8).toISOString() }, { published: true });
    const count = await db.table('workoutOccurrences').count();
    await expect(repo.createRepeats(id, { weekdays: [1, 3], weeks: 2 })).rejects.toThrow('занята');
    expect(await db.table('workoutOccurrences').count()).toBe(count);
    expect(await repo.repeatRuleFor(id)).toBeNull();
    expect(duplicateWorkoutPlan(source.plan).exercises[0].id).not.toBe(source.plan.exercises[0].id);
    expect(startsAtUtc).toBe(source.startsAtUtc);
  });

  it('does not materialize a series from an unpublished workout draft', async () => {
    const { db, repo, source } = fixture();
    const id = (await repo.create(source)).slice(6);
    await expect(repo.createRepeats(id, { weekdays: [1], weeks: 2 }))
      .rejects.toThrow('сохранённая');
    expect(await db.table('workoutOccurrences').count()).toBe(1);
  });
});
