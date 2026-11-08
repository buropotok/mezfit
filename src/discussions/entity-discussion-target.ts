import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { programDiscussionAnchor, occurrenceDiscussionAnchor } from '../data/cloud/discussion-anchors';
import type { DiscussionAnchor, DiscussionScope } from '../data/cloud/discussion-contracts';

export interface EntityDiscussionTarget {
  scope: DiscussionScope;
  anchor: DiscussionAnchor;
  name: string;
}
function scopeFor(realmId: string, actorUserId: string): DiscussionScope {
  return { realmId, coachClientId: realmId === actorUserId ? null : realmId };
}
export function programDiscussionTarget(program: CloudTrainingPlanRow, actorUserId: string): EntityDiscussionTarget {
  const scope = scopeFor(program.realmId, actorUserId);
  return { scope, anchor: programDiscussionAnchor(scope, program), name: program.name };
}
/** The editor ID is a projection of the persisted occurrence, never a second anchor. */
export function plannedDiscussionTarget(draft: LocalWorkoutOccurrenceDraft, exerciseId?: string, setId?: string): EntityDiscussionTarget | null {
  const scope = scopeFor(draft.realmId, draft.actorUserId);
  const exercise = exerciseId === undefined ? null : draft.plan.exercises.find(item => item.id === exerciseId);
  const set = setId === undefined ? null : exercise?.sets.find(item => item.id === setId);
  const name = set ? `${exercise?.exercise.name} · Подход ${set.position + 1}`
    : exercise ? exercise.exercise.name : draft.plan.name;
  return { scope, anchor: occurrenceDiscussionAnchor(scope, { id: draft.targetOccurrenceId ?? draft.id.slice(6),
    realmId: draft.realmId, plan: draft.plan, entryKind: 'workout' }, exerciseId, setId), name };
}
