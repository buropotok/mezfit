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

  it('persists an unpublished choice across repositories and materializes on ordinary Save', async () => {
    const { db, repo, source } = fixture();
    const draftId = await repo.create(source);
    const occurrenceId = draftId.slice(6);
    const rule = { weekdays: [1, 3], weeks: 2 as const };
    await repo.enqueueEdit(draftId, current => ({ ...current, pendingRepeatRule: rule }));

    const reopened = new WorkoutOccurrenceDraftRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    expect((await reopened.get(draftId))?.pendingRepeatRule).toEqual(rule);
    expect(await reopened.repeatStateFor(occurrenceId)).toEqual({ rule, applied: false });
    expect(await db.table('workoutOccurrences').count()).toBe(1);

    expect(await reopened.save(draftId)).toBe(occurrenceId);
    const rows = await db.table('workoutOccurrences').toArray();
    expect(rows).toHaveLength(4);
    expect(rows.find(row => row.id === occurrenceId)).toMatchObject({
      publicationStatus: 'published', pendingRepeatRule: null,
    });
    expect(rows.filter(row => row.repeatSourceId === occurrenceId)).toHaveLength(3);
    expect(await reopened.repeatStateFor(occurrenceId)).toEqual({ rule, applied: true });
    // Repeated Save must never create the same series twice.
    await reopened.save(draftId);
    expect(await db.table('workoutOccurrences').count()).toBe(4);
  });

  it('uses the same publication path for a previously published PLAN revision', async () => {
    const { db, repo, source } = fixture();
    const draftId = await repo.create(source, { published: true });
    await repo.replacePlan(draftId, { ...source.plan, name: 'Изменённый план' });
    const rule = { weekdays: [1], weeks: 2 as const };
    await repo.enqueueEdit(draftId, current => ({ ...current, pendingRepeatRule: rule }));
    expect((await repo.get(draftId))?.saved).toBe(false);

    await repo.save(draftId);
    const rows = await db.table('workoutOccurrences').toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.publicationStatus === 'published')).toBe(true);
    expect(rows.every(row => row.plan.name === 'Изменённый план')).toBe(true);
    expect(rows.find(row => row.id === draftId.slice(6))?.pendingRepeatRule).toBeNull();
  });

  it('keeps the pending rule and unpublished status if any repeated slot is occupied', async () => {
    const { db, repo, source } = fixture();
    const draftId = await repo.create(source);
    await repo.create({ ...source, id: 'draft:' + crypto.randomUUID(),
      startsAtUtc: new Date(2026, 10, 4, 8).toISOString() }, { published: true });
    const rule = { weekdays: [1, 3], weeks: 2 as const };
    await repo.enqueueEdit(draftId, current => ({ ...current, pendingRepeatRule: rule }));
    await expect(repo.save(draftId)).rejects.toThrow('занята');
    const rows = await db.table('workoutOccurrences').toArray();
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === draftId.slice(6))).toMatchObject({
      publicationStatus: 'draft', pendingRepeatRule: rule,
    });
    expect(await repo.repeatStateFor(draftId.slice(6))).toEqual({ rule, applied: false });
  });

  it('can clear a pending choice without publishing or creating any occurrences', async () => {
    const { db, repo, source } = fixture();
    const draftId = await repo.create(source);
    await repo.enqueueEdit(draftId, current => ({ ...current,
      pendingRepeatRule: { weekdays: [1], weeks: 2 } }));
    await repo.enqueueEdit(draftId, current => ({ ...current, pendingRepeatRule: null }));
    expect(await repo.repeatStateFor(draftId.slice(6))).toEqual({ rule: null, applied: false });
    expect((await db.table('workoutOccurrences').get(draftId.slice(6)))?.publicationStatus).toBe('draft');
    await repo.save(draftId);
    expect(await db.table('workoutOccurrences').count()).toBe(1);
  });
});
