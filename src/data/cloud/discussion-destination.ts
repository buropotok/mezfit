import { discussionAnchorKey } from '../../../shared/discussion-anchor';
import type { DiscussionThread } from './discussion-contracts';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';
import type { ActiveWorkoutSession } from '../../workout/workoutSessionTypes';
import { DiscussionRepository } from './discussions';
import { ProgramManagementRepository } from './program-management';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { ClientWorkoutRepository } from './client-workouts';

export type DiscussionDestination = { kind: 'program'; id: string }
  | { kind: 'occurrence'; draft: LocalWorkoutOccurrenceDraft }
  | { kind: 'session'; session: ActiveWorkoutSession<string>; name: string; comment: string | null }
  | { kind: 'unavailable' };

/** Exact identity resolution through the existing authorized readers. Missing child
 * anchors never fall back to a different exercise, PLAN ID, or reusable program. */
export async function readDiscussionDestination(db: MezfitCloudDatabase, actor: string,
  role: 'coach' | 'client', thread: DiscussionThread): Promise<DiscussionDestination> {
  await new DiscussionRepository(db, actor, thread).listThreads(thread.anchor);
  const anchor = thread.anchor;
  if (anchor.kind === 'program') {
    const details = await new ProgramManagementRepository(db, actor).details(anchor.trainingPlanId);
    return details?.program.realmId === thread.realmId
      ? { kind: 'program', id: details.program.id } : { kind: 'unavailable' };
  }
  const repository = role === 'coach' ? new AdHocWorkoutRepository(db, actor) : new ClientWorkoutRepository(db, actor);
  let id = anchor.workout.id;
  if (anchor.workout.kind === 'occurrence') {
    // Execution history survives removal/unpublication of its original calendar row.
    const execution = await repository.getOccurrenceSession(id);
    if (execution) id = execution.id;
    else {
      const draft = await new WorkoutOccurrenceDraftRepository(db, actor).get('draft:' + id);
      if (!draft || draft.realmId !== thread.realmId || draft.workoutSessionId) return { kind: 'unavailable' };
      return anchor.kind === 'workout' ? { kind: 'occurrence', draft } : { kind: 'unavailable' };
    }
  } else if (anchor.workout.kind === 'legacy-session') {
    // Legacy rows have no adopted execution viewer. Never reinterpret their IDs
    // as adHoc/PLAN IDs or open another workout under an historical conversation.
    return { kind: 'unavailable' };
  }
  const row = await repository.getRow(id);
  if (!row || row.realmId !== thread.realmId) return { kind: 'unavailable' };
  const session = await repository.get(id);
  const root = { kind: 'workout' as const, workout: anchor.workout };
  if (!session?.discussion || discussionAnchorKey(thread, session.discussion.anchor) !== discussionAnchorKey(thread, root))
    return { kind: 'unavailable' };
  if (anchor.kind === 'workout') return { kind: 'session', session, name: row.name, comment: row.comment };
  const key = discussionAnchorKey(thread, anchor);
  const exercises = session.exercises.flatMap(exercise => {
    if (anchor.kind === 'exercise') return exercise.discussionAnchor
      && discussionAnchorKey(thread, exercise.discussionAnchor) === key ? [exercise] : [];
    const sets = exercise.sets.filter(set => set.discussionAnchor && discussionAnchorKey(thread, set.discussionAnchor) === key);
    return sets.length ? [{ ...exercise, sets }] : [];
  });
  return exercises.length ? { kind: 'session', session: { ...session, exercises }, name: row.name, comment: row.comment } : { kind: 'unavailable' };
}
