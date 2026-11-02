import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { WorkoutPlanningRepository } from './workout-planning';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';

let db: Dexie;
let planner: WorkoutPlanningRepository;

const plan: WorkoutOccurrencePlan = {
  name: 'Силовая', category: 'strength', comment: 'План тренера',
  exercises: [{
    id: 'ex-original', sourceProgramExerciseId: null, position: 0, notes: 'Техника',
    exercise: { exerciseDefinitionId: 'def-1', scope: 'public', name: 'Жим',
      nameEn: null, mediaUrl: null },
    sets: [{ id: 'set-original', sourceProgramSetId: null, position: 0, setType: 'cluster',
      setLabel: 'normal', comment: 'План подхода', materialLinks: ['https://example.org/a'],
      chatLinks: [], plannedReps: 8, plannedWeightKg: 75,
      plannedDurationSeconds: null, plannedDistanceMeters: null }],
  }],
};

function draft(date: string, durationMinutes = 60): LocalWorkoutOccurrenceDraft {
  return {
    id: 'draft:' + crypto.randomUUID(), actorUserId: 'tg:101', realmId: 'tg:101',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
    format: 'independent', startsAtUtc: date, durationMinutes,
    plan: structuredClone(plan), originalPlan: structuredClone(plan),
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
  db = new Dexie('workout-copy-' + crypto.randomUUID());
  db.version(1).stores({
    workoutOccurrences: 'id, realmId', localWorkoutSync: 'id',
    realms: 'realmId', members: 'id, realmId',
    adHocSessions: 'id, realmId', adHocExercises: 'id, sessionId', adHocSets: 'id, sessionId',
  });
  db.table('workoutOccurrences').hook('creating', (key, row) => {
    if (!key) { row.id = crypto.randomUUID(); return row.id; }
  });
  planner = new WorkoutPlanningRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
});
afterEach(async () => { await db.delete(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('copy scheduled workout without changing its source', () => {
  it('copies the entire PLAN with fresh nested identities into the first free 15-minute slot', async () => {
    const source = await planner.drafts.create(draft('2026-11-04T08:00:00.000Z'));
    await planner.drafts.save(source);
    const copy = await planner.copyOccurrence(source.slice(6), '2026-11-04');
    const saved = await planner.drafts.get(copy);
    expect(saved).toMatchObject({
      saved: true, startsAtUtc: '2026-11-04T09:00:00.000Z',
      durationMinutes: 60, format: 'independent', athleteUserId: 'tg:101',
    });
    expect(saved?.plan).toMatchObject({ name: plan.name, category: plan.category,
      comment: plan.comment, exercises: [{ notes: 'Техника', sets: [{
        setType: 'cluster', plannedReps: 8, plannedWeightKg: 75,
        comment: 'План подхода', materialLinks: ['https://example.org/a'],
      }] }] });
    expect(saved?.plan.exercises[0].id).not.toBe(plan.exercises[0].id);
    expect(saved?.plan.exercises[0].sets[0].id).not.toBe(plan.exercises[0].sets[0].id);
    expect((await planner.drafts.get(source))?.plan).toEqual(plan);
    expect(await db.table('workoutOccurrences').count()).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not spill into the next calendar day when the selected day is full', async () => {
    const source = await planner.drafts.create(draft('2026-11-04T08:00:00.000Z'));
    const allDay = await planner.drafts.create(draft('2026-11-05T08:00:00.000Z', 840));
    await planner.drafts.save(allDay);
    await expect(planner.copyOccurrence(source.slice(6), '2026-11-05'))
      .rejects.toThrow('На выбранную дату нет свободного слота');
    await expect(planner.copyOccurrence(source.slice(6), '2026-02-30'))
      .rejects.toThrow('Некорректная дата');
    expect(await db.table('workoutOccurrences').count()).toBe(2);
  });

  it('preserves the authorized relationship and does not write a program template', async () => {
    const pair = await relationshipMembership('101', '202');
    await db.table('realms').put(pair.realm);
    await db.table('members').bulkPut(pair.members);
    const source = await planner.drafts.create({ ...draft('2026-11-04T10:00:00.000Z'),
      realmId: pair.realm.realmId, athleteUserId: 'tg:202',
      coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached' });
    const copy = await planner.copyOccurrence(source.slice(6), '2026-11-06');
    expect(await planner.drafts.get(copy)).toMatchObject({
      saved: true, realmId: pair.realm.realmId, athleteUserId: 'tg:202',
      coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
      startsAtUtc: '2026-11-06T08:00:00.000Z',
    });
    expect((await db.table('workoutOccurrences').get(copy.slice(6))).workoutSessionId).toBeNull();
  });
});

function sessionRow(id: string) {
  return {
    id, realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
    coachUserId: null, clientUserId: null, creatorUserId: 'tg:101',
    name: 'Факт', comment: 'Записанный комментарий', programName: null,
    autoCreatedProgram: false, status: 'completed', startedAt: '2026-11-02T09:00:00.000Z',
    completedAt: '2026-11-02T10:00:00.000Z',
    createdAt: '2026-11-02T09:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
  };
}

describe('copy an executed session as PLAN only', () => {
  it('uses frozen occurrence PLAN rather than edited FACT and preserves planned numbers', async () => {
    const original = await planner.drafts.create(draft('2026-11-02T08:00:00.000Z', 75));
    const occurrenceId = original.slice(6);
    await db.table('workoutOccurrences').update(occurrenceId, {
      status: 'completed', workoutSessionId: 'frozen-session',
    });
    await db.table('adHocSessions').add({
      ...sessionRow('frozen-session'), occurrenceId, occurrencePlan: structuredClone(plan),
    });
    await db.table('adHocExercises').add({
      id: 'fact-added', sessionId: 'frozen-session', realmId: 'tg:101', owner: 'tg:101',
      position: 0, exercise: { exerciseDefinitionId: 'other', name: 'Другое',
        nameEn: null, mediaUrl: null, scope: 'public', trackingType: 'weight_reps' },
      notes: null, deletedAt: null,
    });
    const copy = await planner.copySession('frozen-session', '2026-11-07');
    const result = await planner.drafts.get(copy);
    expect(result?.plan).toMatchObject({ name: 'Силовая',
      exercises: [{ sets: [{ plannedWeightKg: 75, plannedReps: 8 }] }] });
    expect(result?.plan.exercises).toHaveLength(1);
    expect(result).toMatchObject({ durationMinutes: 75, saved: true });
    expect(result?.executionStatus).toBeUndefined();
    expect(result?.workoutSessionId).toBeUndefined();
    expect(await db.table('adHocSessions').count()).toBe(1);
  });

  it('turns an ad-hoc FACT graph into a clean exercise/set skeleton with no results', async () => {
    await db.table('adHocSessions').add(sessionRow('adhoc-session'));
    await db.table('adHocExercises').add({
      id: 'ex-fact', sessionId: 'adhoc-session', realmId: 'tg:101', owner: 'tg:101',
      position: 0, exercise: { exerciseDefinitionId: 'def-1', name: 'Жим',
        nameEn: null, mediaUrl: null, scope: 'public', trackingType: 'weight_reps' },
      notes: 'Следить за техникой', deletedAt: null,
    });
    await db.table('adHocSets').add({
      id: 'set-fact', sessionId: 'adhoc-session', exerciseId: 'ex-fact',
      realmId: 'tg:101', owner: 'tg:101', position: 0, deletedAt: null,
      setType: 'cluster', setLabel: 'hard', actualReps: 15, actualWeightKg: 120,
      actualDurationSeconds: null, actualDistanceMeters: null, rpe: 10,
      comment: 'Реальные ощущения', bands: ['blue'], setStatus: 'completed',
    });
    const copy = await planner.copySession('adhoc-session', '2026-11-05');
    const result = await planner.drafts.get(copy);
    expect(result).toMatchObject({ saved: true, startsAtUtc: '2026-11-05T08:00:00.000Z',
      plan: { name: 'Факт', comment: null, exercises: [{
        notes: 'Следить за техникой', sets: [{
          setType: 'cluster', plannedReps: null, plannedWeightKg: null,
          plannedDurationSeconds: null, plannedDistanceMeters: null,
          comment: null, materialLinks: [], chatLinks: [],
        }],
      }] },
    });
    expect(JSON.stringify(result?.plan)).not.toMatch(/actualReps|actualWeightKg|rpe|setStatus|Реальные ощущения/);
    expect(await db.table('adHocSets').count()).toBe(1);
  });

  it('rejects inaccessible source sessions', async () => {
    await db.table('adHocSessions').add({ ...sessionRow('other'), realmId: 'tg:999',
      owner: 'tg:999', athleteUserId: 'tg:999', creatorUserId: 'tg:999' });
    await expect(planner.copySession('other', '2026-11-05')).rejects.toThrow('недоступна');
    expect(await db.table('workoutOccurrences').count()).toBe(0);
  });
});
