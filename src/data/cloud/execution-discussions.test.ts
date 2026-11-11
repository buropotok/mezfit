import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17, type MezfitCloudDatabase } from './database';
import { ClientWorkoutRepository } from './client-workouts';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { occurrenceDiscussionAnchor } from './discussion-anchors';
import { entityDiscussionId } from './discussions';
import { readDiscussionDestination } from './discussion-destination';
import { discussionAnchorKey, discussionParents } from '../../../shared/discussion-anchor';
import type { DiscussionThread } from './discussion-contracts';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
const time = '2026-11-07T10:00:00.000Z';
async function fixture(scheduled: boolean) {
  // Real local reads/transactions; projection needs no Addon or network mock.
  const db = new Dexie('execution-discussions-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  db.version(17).stores(Object.fromEntries(Object.entries(CLOUD_DATABASE_STORES_V17)
    .map(([name, schema]) => [name, schema?.replaceAll('@', '') ?? null])));
  const pair = await relationshipMembership('11', '22');
  await db.table('realms').put(pair.realm);
  await db.table('members').bulkPut(pair.members);
  const snapshot = { exerciseDefinitionId: 'catalogue', scope: 'public' as const, name: 'Жим',
    nameEn: null, mediaUrl: null, trackingType: 'weight_reps' as const };
  const plan: WorkoutOccurrencePlan = { name: 'План', comment: 'Инструкция PLAN', exercises: [{
    id: 'occurrence-exercise', sourceProgramExerciseId: 'program-exercise', position: 0,
    exercise: snapshot, notes: 'Техника PLAN', sets: [{ id: 'occurrence-set', sourceProgramSetId: 'program-set',
      position: 0, setType: null, setLabel: null, comment: 'Пауза PLAN', materialLinks: [], chatLinks: ['legacy-link'],
      plannedReps: 8, plannedWeightKg: 50, plannedDurationSeconds: null, plannedDistanceMeters: null }],
  }] };
  const session: AdHocSessionRow = { id: 'execution', realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:22', clientUserId: 'tg:22', coachUserId: 'tg:11', creatorUserId: 'tg:11',
    name: 'Тренировка', comment: 'Заметка FACT', programName: null, autoCreatedProgram: false,
    ...(scheduled ? { occurrenceId: 'occurrence', occurrencePlan: plan } : {}),
    startedAt: time, completedAt: time, status: 'completed', createdAt: time, updatedAt: time };
  const exercise: AdHocExerciseRow = { id: 'execution-exercise', realmId: session.realmId, owner: session.owner,
    sessionId: session.id, ...(scheduled ? { occurrenceExerciseId: 'occurrence-exercise' } : {}),
    position: 0, exercise: snapshot, notes: 'Техника FACT', deletedAt: null };
  const set: AdHocSetRow = { id: 'execution-set', realmId: session.realmId, owner: session.owner,
    sessionId: session.id, exerciseId: exercise.id, ...(scheduled ? { occurrenceSetId: 'occurrence-set' } : {}),
    position: 0, deletedAt: null, setType: null, actualReps: 8, actualWeightKg: 50,
    actualDurationSeconds: null, actualDistanceMeters: null, setLabel: null, rpe: 8,
    comment: 'Тяжело FACT', bands: [], setStatus: 'completed' };
  await db.table('adHocSessions').put(session);
  await db.table('adHocExercises').put(exercise);
  await db.table('adHocSets').put(set);
  const database = db as unknown as MezfitCloudDatabase; // Typed repository port over real IndexedDB fixture.
  return { db, session, exercise, set, plan, coach: new AdHocWorkoutRepository(database, 'tg:11'),
    client: new ClientWorkoutRepository(database, 'tg:22') };
}

describe('COMM-07 authorized execution projections', () => {
  it.each(['coached', 'independent'] as const)('COMM-08 lets an athlete read a published %s occurrence without editor rights', async format => {
    const { db, session, plan } = await fixture(true);
    await db.table('adHocSessions').clear();
    const occurrence: CloudWorkoutOccurrenceRow = { id: 'occurrence', realmId: session.realmId, owner: session.realmId,
      athleteUserId: 'tg:22', coachUserId: 'tg:11', clientUserId: 'tg:22', format,
      plan, workoutSessionId: null, startsAtUtc: time, durationMinutes: 60, status: 'scheduled',
      publicationStatus: 'published', createdByUserId: 'tg:11', draftAuthorUserId: 'tg:11' };
    await db.table('workoutOccurrences').put(occurrence);
    const scope = { realmId: session.realmId, coachClientId: session.realmId };
    const anchor = occurrenceDiscussionAnchor(scope, occurrence);
    const thread: DiscussionThread = { ...scope, id: 'planned-thread', owner: scope.realmId, anchor,
      anchorKey: discussionAnchorKey(scope, anchor), contextPath: [], derivedTitleSnapshot: 'План',
      createdAt: time, lastActivityAt: time };
    const database = db as unknown as MezfitCloudDatabase;
    for (const [actor, role] of [['tg:11', 'coach'], ['tg:22', 'client']] as const) {
      const target = await readDiscussionDestination(database, actor, role, thread);
      expect(target.kind).toBe('occurrence');
      if (target.kind !== 'occurrence') throw Error('Expected readable calendar PLAN');
      expect(target.draft.targetOccurrenceId).toBe(occurrence.id);
      expect(target.draft.plan).toEqual(plan);
    }
    expect(await db.table('workoutOccurrences').get(occurrence.id)).toEqual(occurrence);
    await db.table('workoutOccurrences').update(occurrence.id, { publicationStatus: 'draft' });
    expect(await readDiscussionDestination(database, 'tg:22', 'client', thread)).toEqual({ kind: 'unavailable' });
    await db.table('workoutOccurrences').update(occurrence.id, { publicationStatus: 'published', inactive: true });
    expect(await readDiscussionDestination(database, 'tg:22', 'client', thread)).toEqual({ kind: 'unavailable' });
    await db.table('workoutOccurrences').put({ ...occurrence, realmId: 'tg:22', owner: 'tg:22',
      coachUserId: null, clientUserId: null, format: 'independent' });
    expect(await readDiscussionDestination(database, 'tg:22', 'client', thread)).toEqual({ kind: 'unavailable' });
    await expect(readDiscussionDestination(database, 'tg:33', 'coach', thread)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });

  it.each([false, true])('COMM-08 resolves an exact approach and retains execution without its calendar row (scheduled=%s)', async scheduled => {
    const { db, coach, session, exercise, set } = await fixture(scheduled);
    // The destination must keep unrelated exercises and approaches visible.
    await db.table('adHocExercises').put({ ...exercise, id: 'other-exercise', position: 1,
      occurrenceExerciseId: undefined });
    await db.table('adHocSets').put({ ...set, id: 'other-set', exerciseId: 'other-exercise',
      occurrenceSetId: undefined });
    const projected = await coach.get(session.id);
    const anchor = projected?.exercises[0].sets[0].discussionAnchor;
    if (!anchor) throw Error('Missing execution anchor');
    const scope = { realmId: session.realmId, coachClientId: session.realmId };
    const thread: DiscussionThread = { ...scope, id: 'thread', owner: scope.realmId, anchor,
      anchorKey: discussionAnchorKey(scope, anchor), contextPath: discussionParents(anchor),
      derivedTitleSnapshot: 'Подход', createdAt: time, lastActivityAt: time };
    const database = db as unknown as MezfitCloudDatabase;
    for (const [actor, role] of [['tg:11', 'coach'], ['tg:22', 'client']] as const) {
      const target = await readDiscussionDestination(database, actor, role, thread);
      expect(target.kind).toBe('session');
      if (target.kind !== 'session') throw Error('Expected exact execution');
      expect(target.session.exercises).toHaveLength(2);
      expect(target.session.exercises[0].sets.map(row => row.sessionSetId)).toEqual([set.id]);
      expect(target.session.exercises[1].sets.map(row => row.sessionSetId)).toEqual(['other-set']);
      expect(target.focus).toEqual({ exerciseId: exercise.id, setId: set.id });
      expect(target.comment).toBe('Заметка FACT');
      expect(target.session.exercises[0].notes).toBe('Техника FACT');
    }
    await db.table('adHocSets').update(set.id, { deletedAt: time });
    expect(await readDiscussionDestination(database, 'tg:11', 'coach', thread)).toEqual({ kind: 'unavailable' });
    await expect(readDiscussionDestination(database, 'tg:33', 'coach', thread)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });

  it.each([false, true])('keeps canonical identities and preserves stored PLAN/FACT (scheduled=%s)', async scheduled => {
    const { db, coach, client, session, exercise, set, plan } = await fixture(scheduled);
    const before = await Promise.all(['adHocSessions', 'adHocExercises', 'adHocSets'].map(name => db.table(name).toArray()));
    const projected = await coach.get(session.id);
    expect(await client.get(session.id)).toEqual(projected);
    expect(projected?.exercises[0]).toMatchObject({ sessionExerciseId: exercise.id, notes: 'Техника FACT' });
    expect(projected?.exercises[0].sets[0]).toMatchObject({ sessionSetId: set.id, fact: { comment: 'Тяжело FACT', rpe: 8 } });
    const discussion = projected?.discussion;
    if (!discussion) throw Error('Missing canonical workout context');
    expect(discussion.anchor).toEqual({ kind: 'workout', workout: { kind: scheduled ? 'occurrence' : 'session',
      id: scheduled ? 'occurrence' : session.id } });
    if (scheduled) {
      const planned = occurrenceDiscussionAnchor(discussion.scope, { id: 'occurrence', realmId: session.realmId, plan, entryKind: 'workout' });
      expect(await entityDiscussionId(discussion.scope, discussion.anchor)).toBe(await entityDiscussionId(discussion.scope, planned));
      expect(projected?.exercises[0].sets[0].discussionAnchor).toEqual(occurrenceDiscussionAnchor(discussion.scope,
        { id: 'occurrence', realmId: session.realmId, plan, entryKind: 'workout' }, 'occurrence-exercise', 'occurrence-set'));
    } else {
      expect(projected?.exercises[0].sets[0].discussionAnchor).toEqual({ kind: 'set', workout: { kind: 'session', id: session.id },
        exercise: { kind: 'execution', id: exercise.id }, set: { kind: 'execution', id: set.id } });
    }
    expect(await Promise.all(['adHocSessions', 'adHocExercises', 'adHocSets'].map(name => db.table(name).toArray()))).toEqual(before);
    expect(await new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:33').get(session.id)).toBeNull();
  });

  it('never guesses an execution set from an equal catalogue/PLAN ID or its position', async () => {
    const { db, coach, session, exercise, set } = await fixture(false);
    await db.table('adHocSets').put({ ...set, id: 'other-execution-set', position: 1 });
    const first = await coach.get(session.id);
    const anchor = first?.exercises[0].sets.find(row => row.sessionSetId === set.id)?.discussionAnchor;
    await db.table('adHocSets').update(set.id, { position: 4 });
    await db.table('adHocSets').update('other-execution-set', { position: 0 });
    const reordered = await coach.get(session.id);
    expect(reordered?.exercises[0].sets.find(row => row.sessionSetId === set.id)?.discussionAnchor).toEqual(anchor);
    expect(reordered?.exercises[0].sets[0].discussionAnchor).not.toEqual(anchor);
    await db.table('adHocSets').update(set.id, { deletedAt: time });
    expect((await coach.get(session.id))?.exercises[0].sets.map(row => row.sessionSetId)).toEqual(['other-execution-set']);
    // Corrupt provenance must not attach to a template or prevent reading historical results.
    await db.table('adHocExercises').update(exercise.id, { occurrenceExerciseId: 'foreign-plan-exercise' });
    const invalid = await coach.get(session.id);
    expect(invalid?.exercises[0].discussionAnchor).toBeUndefined();
    expect(invalid?.exercises[0].sets[0].discussionAnchor).toBeUndefined();
    expect(invalid?.exercises[0].sets[0].fact?.comment).toBe('Тяжело FACT');
  });
});

describe('COMM-08 planned child destinations before Start', () => {
  it.each(['exercise', 'set'] as const)('opens the exact %s PLAN child for Coach and Client', async kind => {
    const { db, session, plan } = await fixture(true);
    await db.table('adHocSessions').clear();
    const occurrence: CloudWorkoutOccurrenceRow = { id: 'occurrence', realmId: session.realmId, owner: session.realmId,
      athleteUserId: 'tg:22', coachUserId: 'tg:11', clientUserId: 'tg:22', format: 'coached',
      plan, workoutSessionId: null, startsAtUtc: time, durationMinutes: 60, status: 'scheduled',
      publicationStatus: 'published', createdByUserId: 'tg:11', draftAuthorUserId: 'tg:11' };
    await db.table('workoutOccurrences').put(occurrence);
    const scope = { realmId: session.realmId, coachClientId: session.realmId };
    const anchor = occurrenceDiscussionAnchor(scope, occurrence, 'occurrence-exercise',
      kind === 'set' ? 'occurrence-set' : undefined);
    const thread: DiscussionThread = { ...scope, id: 'planned-child', owner: scope.realmId, anchor,
      anchorKey: discussionAnchorKey(scope, anchor), contextPath: discussionParents(anchor),
      derivedTitleSnapshot: 'Подход PLAN', createdAt: time, lastActivityAt: time };
    const database = db as unknown as MezfitCloudDatabase;
    for (const [actor, role] of [['tg:11', 'coach'], ['tg:22', 'client']] as const) {
      const destination = await readDiscussionDestination(database, actor, role, thread);
      expect(destination.kind).toBe('occurrence');
      if (destination.kind !== 'occurrence') throw Error('Expected planned child');
      expect(destination.draft.targetOccurrenceId).toBe('occurrence');
      expect(destination.draft.plan).toEqual(plan);
      expect(destination.focus).toEqual(kind === 'set'
        ? { exerciseId: 'occurrence-exercise', setId: 'occurrence-set' }
        : { exerciseId: 'occurrence-exercise' });
    }
    // A replacement with the same source/template ID must never inherit the old discussion.
    const changedPlan = { ...plan, exercises: plan.exercises.map(exercise => ({
      ...exercise, ...(kind === 'exercise'
        ? { id: 'replacement-exercise' }
        : { sets: exercise.sets.map(set => ({ ...set, id: 'replacement-set' })) }),
    })) };
    await db.table('workoutOccurrences').update('occurrence', { plan: changedPlan });
    for (const [actor, role] of [['tg:11', 'coach'], ['tg:22', 'client']] as const) {
      expect(await readDiscussionDestination(database, actor, role, thread)).toEqual({ kind: 'unavailable' });
    }
    await db.table('workoutOccurrences').update('occurrence', { plan, publicationStatus: 'draft' });
    expect(await readDiscussionDestination(database, 'tg:22', 'client', thread)).toEqual({ kind: 'unavailable' });
    await expect(readDiscussionDestination(database, 'tg:33', 'coach', thread))
      .rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });
});
