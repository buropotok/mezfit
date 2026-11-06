import type { DiscussionAnchor, DiscussionInstance, DiscussionScope, DiscussionWorkout } from '../../../shared/discussion-anchor';
import { discussionAnchorKey, discussionId } from '../../../shared/discussion-anchor';
import type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';
import type { CloudSessionExerciseRow, CloudSessionFactExerciseRow, CloudSessionFactSetRow, CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { CloudSessionSetRow, CloudSessionSetFactRow, CloudWorkoutSessionRow, CloudTrainingPlanRow } from './database';

const fail = (): never => { throw new Error('DISCUSSION_CONTEXT_MISMATCH'); };
function sameRealm(scope: DiscussionScope, ...rows: Array<{ realmId: string }>) {
  if (rows.some(row => row.realmId !== scope.realmId)) fail();
}
function result(scope: DiscussionScope, root: DiscussionWorkout, exercise?: DiscussionInstance, set?: DiscussionInstance): DiscussionAnchor {
  const anchor: DiscussionAnchor = set && exercise ? { kind: 'set', workout: root, exercise, set }
    : exercise ? { kind: 'exercise', workout: root, exercise } : { kind: 'workout', workout: root };
  discussionAnchorKey(scope, anchor);
  return anchor;
}
export function programDiscussionAnchor(scope: DiscussionScope, plan: Pick<CloudTrainingPlanRow, 'id' | 'realmId'>): DiscussionAnchor {
  sameRealm(scope, plan);
  const anchor: DiscussionAnchor = { kind: 'program', trainingPlanId: plan.id };
  discussionAnchorKey(scope, anchor); return anchor;
}
export function occurrenceDiscussionAnchor(
  scope: DiscussionScope, row: Pick<CloudWorkoutOccurrenceRow, 'id' | 'realmId' | 'plan' | 'entryKind'>,
  exerciseId?: string, setId?: string,
): DiscussionAnchor {
  sameRealm(scope, row);
  if (row.entryKind === 'personal_event' || (setId !== undefined && exerciseId === undefined)) fail();
  const exercise = exerciseId === undefined ? undefined : row.plan.exercises.find(item => item.id === exerciseId);
  if (exerciseId !== undefined && !exercise) fail();
  if (setId !== undefined && !exercise?.sets.some(item => item.id === setId)) fail();
  return result(scope, { kind: 'occurrence', id: row.id },
    exercise ? { kind: 'occurrence', id: exercise.id } : undefined,
    setId !== undefined ? { kind: 'occurrence', id: setId } : undefined);
}
export function executionDiscussionAnchor(
  scope: DiscussionScope, session: Pick<AdHocSessionRow, 'id' | 'realmId' | 'occurrenceId' | 'occurrencePlan'>,
  exercise?: Pick<AdHocExerciseRow, 'id' | 'realmId' | 'sessionId' | 'occurrenceExerciseId'>,
  set?: Pick<AdHocSetRow, 'id' | 'realmId' | 'sessionId' | 'exerciseId' | 'occurrenceSetId'>,
): DiscussionAnchor {
  sameRealm(scope, session, ...(exercise ? [exercise] : []), ...(set ? [set] : []));
  if ((set && !exercise) || (exercise && exercise.sessionId !== session.id)
    || (set && (set.sessionId !== session.id || set.exerciseId !== exercise?.id))) fail();
  if (!discussionId(session.id) || (exercise && !discussionId(exercise.id)) || (set && !discussionId(set.id))
    || (session.occurrenceId !== undefined && (!discussionId(session.occurrenceId) || !session.occurrencePlan))
    || (exercise?.occurrenceExerciseId !== undefined && !discussionId(exercise.occurrenceExerciseId))
    || (set?.occurrenceSetId !== undefined && !discussionId(set.occurrenceSetId))) fail();
  const root: DiscussionWorkout = session.occurrenceId
    ? { kind: 'occurrence', id: session.occurrenceId } : { kind: 'session', id: session.id };
  const origin = exercise?.occurrenceExerciseId
    ? session.occurrencePlan?.exercises.find(item => item.id === exercise.occurrenceExerciseId) : undefined;
  if (exercise?.occurrenceExerciseId && (!session.occurrenceId || !origin)) fail();
  if (set?.occurrenceSetId && (!origin || !origin.sets.some(item => item.id === set.occurrenceSetId))) fail();
  return result(scope, root, exercise ? { kind: origin ? 'occurrence' : 'execution', id: origin?.id ?? exercise.id } : undefined,
    set ? { kind: set.occurrenceSetId ? 'occurrence' : 'execution', id: set.occurrenceSetId ?? set.id } : undefined);
}
/** Legacy has no proven occurrence provenance: never merge it by program ID or position. */
export function legacyDiscussionAnchor(
  scope: DiscussionScope, session: Pick<CloudWorkoutSessionRow, 'id' | 'realmId'>,
  exercise?: Pick<CloudSessionExerciseRow, 'id' | 'realmId' | 'workoutSessionId'>,
  set?: Pick<CloudSessionSetRow, 'id' | 'realmId' | 'workoutSessionId' | 'sessionExerciseId'>,
  fact?: Pick<CloudSessionSetFactRow, 'realmId' | 'workoutSessionId' | 'sessionSetId'>,
): DiscussionAnchor {
  sameRealm(scope, session, ...(exercise ? [exercise] : []), ...(set ? [set] : []), ...(fact ? [fact] : []));
  if ((set && !exercise) || (fact && !set) || (exercise && exercise.workoutSessionId !== session.id)
    || (set && (set.workoutSessionId !== session.id || set.sessionExerciseId !== exercise?.id))
    || (fact && (fact.workoutSessionId !== session.id || fact.sessionSetId !== set?.id))) fail();
  return result(scope, { kind: 'legacy-session', id: session.id }, exercise ? { kind: 'legacy', id: exercise.id } : undefined,
    set ? { kind: 'legacy', id: set.id } : undefined);
}

/** FACT-added legacy rows have a separate instance namespace from legacy PLAN snapshots. */
export function legacyFactDiscussionAnchor(
  scope: DiscussionScope, session: Pick<CloudWorkoutSessionRow, 'id' | 'realmId'>,
  exercise: Pick<CloudSessionFactExerciseRow, 'id' | 'realmId' | 'workoutSessionId'>,
  set?: Pick<CloudSessionFactSetRow, 'id' | 'realmId' | 'workoutSessionId' | 'sessionFactExerciseId'>,
): DiscussionAnchor {
  sameRealm(scope, session, exercise, ...(set ? [set] : []));
  if (exercise.workoutSessionId !== session.id || (set && (set.workoutSessionId !== session.id
    || set.sessionFactExerciseId !== exercise.id))) fail();
  return result(scope, { kind: 'legacy-session', id: session.id }, { kind: 'legacy-fact', id: exercise.id },
    set ? { kind: 'legacy-fact', id: set.id } : undefined);
}
