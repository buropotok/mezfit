/** Navigation identity only. Anchors never grant additional access within a realm. */
export type DiscussionWorkout = { kind: 'occurrence' | 'session' | 'legacy-session'; id: string };
export type DiscussionInstance = { kind: 'occurrence' | 'execution' | 'legacy' | 'legacy-fact'; id: string };
export type DiscussionAnchor =
  | { kind: 'program'; trainingPlanId: string }
  | { kind: 'workout'; workout: DiscussionWorkout }
  | { kind: 'exercise'; workout: DiscussionWorkout; exercise: DiscussionInstance }
  | { kind: 'set'; workout: DiscussionWorkout; exercise: DiscussionInstance; set: DiscussionInstance };
export interface DiscussionScope { realmId: string; coachClientId: string | null }
export const discussionRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const discussionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
const keys = (row: Record<string, unknown>, expected: string[]) =>
  Object.keys(row).length === expected.length && expected.every(key => Object.hasOwn(row, key));
function workout(value: unknown): value is DiscussionWorkout {
  return discussionRecord(value) && keys(value, ['kind', 'id']) && discussionId(value.id)
    && ['occurrence', 'session', 'legacy-session'].includes(String(value.kind));
}
function instance(value: unknown, parent: DiscussionWorkout): value is DiscussionInstance {
  return discussionRecord(value) && keys(value, ['kind', 'id']) && discussionId(value.id)
    && (parent.kind === 'occurrence' ? value.kind === 'occurrence' || value.kind === 'execution'
      : parent.kind === 'session' ? value.kind === 'execution' : value.kind === 'legacy' || value.kind === 'legacy-fact');
}
export function isDiscussionAnchor(value: unknown): value is DiscussionAnchor {
  if (!discussionRecord(value)) return false;
  if (value.kind === 'program') return keys(value, ['kind', 'trainingPlanId']) && discussionId(value.trainingPlanId);
  if (!workout(value.workout)) return false;
  if (value.kind === 'workout') return keys(value, ['kind', 'workout']);
  if (!instance(value.exercise, value.workout)) return false;
  if (value.kind === 'exercise') return keys(value, ['kind', 'workout', 'exercise']);
  return value.kind === 'set' && keys(value, ['kind', 'workout', 'exercise', 'set'])
    && instance(value.set, value.workout)
    && !(value.exercise.kind === 'execution' && value.set.kind === 'occurrence')
    && (value.workout.kind !== 'legacy-session' || value.exercise.kind === value.set.kind);
}
/** Explicit arrays keep key generation independent of object property insertion order. */
export function discussionAnchorKey(scope: DiscussionScope, anchor: DiscussionAnchor): string {
  if (!discussionId(scope.realmId) || (scope.coachClientId !== null && scope.coachClientId !== scope.realmId)
    || !isDiscussionAnchor(anchor)) throw new Error('INVALID_DISCUSSION_ANCHOR');
  const head = [scope.realmId, scope.coachClientId, anchor.kind];
  if (anchor.kind === 'program') return JSON.stringify([...head, anchor.trainingPlanId]);
  const root = [...head, anchor.workout.kind, anchor.workout.id];
  if (anchor.kind === 'workout') return JSON.stringify(root);
  const exercise = [...root, anchor.exercise.kind, anchor.exercise.id];
  return JSON.stringify(anchor.kind === 'exercise' ? exercise : [...exercise, anchor.set.kind, anchor.set.id]);
}
export function discussionParents(anchor: DiscussionAnchor): DiscussionAnchor[] {
  if (!isDiscussionAnchor(anchor)) throw new Error('INVALID_DISCUSSION_ANCHOR');
  if (anchor.kind === 'program' || anchor.kind === 'workout') return [];
  const parents: DiscussionAnchor[] = [{ kind: 'workout', workout: { ...anchor.workout } }];
  if (anchor.kind === 'set') parents.push({ kind: 'exercise', workout: { ...anchor.workout }, exercise: { ...anchor.exercise } });
  return parents;
}
export function discussionTitle(entityName: string, date: string): string {
  const timestamp = Date.parse(date + 'T00:00:00.000Z');
  if (!entityName.trim() || entityName.trim().length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)
    throw new Error('INVALID_DISCUSSION_TITLE');
  return `${entityName.trim()} · ${date}`;
}
