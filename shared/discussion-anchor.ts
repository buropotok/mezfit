/** Navigation identity only. Anchors never grant additional access within a realm. */
export type DiscussionWorkout = { kind: 'occurrence' | 'session' | 'legacy-session'; id: string };
export type DiscussionInstance = { kind: 'occurrence' | 'execution' | 'legacy' | 'legacy-fact'; id: string };
export type EntityDiscussionAnchor =
  | { kind: 'program'; trainingPlanId: string }
  | { kind: 'workout'; workout: DiscussionWorkout }
  | { kind: 'exercise'; workout: DiscussionWorkout; exercise: DiscussionInstance }
  | { kind: 'set'; workout: DiscussionWorkout; exercise: DiscussionInstance; set: DiscussionInstance };
export type FreeDiscussionAnchor = { kind: 'free'; threadId: string };
export type DiscussionAnchor = EntityDiscussionAnchor | FreeDiscussionAnchor;
export const FREE_DISCUSSION_ID_PREFIX = 'free-discussion:';
export const DISCUSSION_TITLE_MAX_LENGTH = 120;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isFreeDiscussionId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(FREE_DISCUSSION_ID_PREFIX)
    && id.length === FREE_DISCUSSION_ID_PREFIX.length + 36 && uuidV4.test(id.slice(FREE_DISCUSSION_ID_PREFIX.length));
}

/** Anchor kind and the reserved free thread namespace must agree on both read boundaries. */
export function matchesDiscussionThreadAnchor(anchor: DiscussionAnchor, id: string, title: unknown, contextPath: unknown): boolean {
  if (anchor.kind !== 'free') return !isFreeDiscussionId(id);
  return anchor.threadId === id && typeof title === 'string' && title === title.trim()
    && title.length > 0 && title.length <= DISCUSSION_TITLE_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(title)
    && Array.isArray(contextPath) && contextPath.length === 0;
}
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
  if (value.kind === 'free') return keys(value, ['kind', 'threadId'])
    && isFreeDiscussionId(value.threadId);
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
  if (anchor.kind === 'free') {
    if (scope.coachClientId === null) throw new Error('INVALID_DISCUSSION_ANCHOR');
    return JSON.stringify([...head, anchor.threadId]);
  }
  if (anchor.kind === 'program') return JSON.stringify([...head, anchor.trainingPlanId]);
  const root = [...head, anchor.workout.kind, anchor.workout.id];
  if (anchor.kind === 'workout') return JSON.stringify(root);
  const exercise = [...root, anchor.exercise.kind, anchor.exercise.id];
  return JSON.stringify(anchor.kind === 'exercise' ? exercise : [...exercise, anchor.set.kind, anchor.set.id]);
}
export function discussionParents(anchor: DiscussionAnchor): EntityDiscussionAnchor[] {
  if (!isDiscussionAnchor(anchor)) throw new Error('INVALID_DISCUSSION_ANCHOR');
  if (anchor.kind === 'free' || anchor.kind === 'program' || anchor.kind === 'workout') return [];
  const parents: EntityDiscussionAnchor[] = [{ kind: 'workout', workout: { ...anchor.workout } }];
  if (anchor.kind === 'set') parents.push({ kind: 'exercise', workout: { ...anchor.workout }, exercise: { ...anchor.exercise } });
  return parents;
}
export function discussionTitle(entityName: string, date: string): string {
  const timestamp = Date.parse(date + 'T00:00:00.000Z');
  if (!entityName.trim() || entityName.trim().length > DISCUSSION_TITLE_MAX_LENGTH || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)
    throw new Error('INVALID_DISCUSSION_TITLE');
  return `${entityName.trim()} · ${date}`;
}
