import { describe, expect, it } from 'vitest';
import { discussionAnchorKey, discussionParents, discussionTitle, isDiscussionAnchor } from '../../../shared/discussion-anchor';
import { occurrenceDiscussionAnchor, executionDiscussionAnchor, legacyDiscussionAnchor, legacyFactDiscussionAnchor } from './discussion-anchors';
import { assertDiscussionMessageWrite, assertDiscussionReadStateWrite, discussionReadStateId,
  type DiscussionThread, type DiscussionMessage } from './discussion-contracts';

const scope = { realmId: 'pair-a', coachClientId: 'pair-a' };
const plan = { name: 'Day', comment: null, exercises: [{ id: 'planned-ex', sourceProgramExerciseId: null,
  position: 0, notes: null, exercise: { exerciseDefinitionId: 'catalogue', name: 'Squat', nameEn: null, mediaUrl: null, scope: 'public' as const },
  sets: [{ id: 'planned-set', sourceProgramSetId: null, position: 0, setLabel: null, comment: null,
    materialLinks: [], chatLinks: [], plannedReps: 8, plannedWeightKg: 80, plannedDurationSeconds: null, plannedDistanceMeters: null }] }] };
const occurrence = { id: 'occurrence', realmId: scope.realmId, plan };
const session = { id: 'session', realmId: scope.realmId, occurrenceId: occurrence.id, occurrencePlan: plan };
const exercise = { id: 'actual-ex', realmId: scope.realmId, sessionId: session.id, occurrenceExerciseId: 'planned-ex' };
const set = { id: 'actual-set', realmId: scope.realmId, sessionId: session.id, exerciseId: exercise.id, occurrenceSetId: 'planned-set' };
const time = '2026-11-06T10:00:00.000Z';
const anchor = occurrenceDiscussionAnchor(scope, occurrence, 'planned-ex', 'planned-set');
const thread: DiscussionThread = { ...scope, id: 'thread', owner: scope.realmId, anchor,
  anchorKey: discussionAnchorKey(scope, anchor), contextPath: discussionParents(anchor),
  derivedTitleSnapshot: discussionTitle('Squat', '2026-11-06'), createdAt: time, lastActivityAt: time };
const message: DiscussionMessage = { id: 'message', realmId: scope.realmId, owner: 'tg:1', authorUserId: 'tg:1', threadId: thread.id, text: 'hello', createdAt: time };

describe('canonical discussion contexts', () => {
  it('keeps occurrence and execution set/exercise/workout keys identical', () => {
    for (const [before, after] of [
      [occurrenceDiscussionAnchor(scope, occurrence), executionDiscussionAnchor(scope, session)],
      [occurrenceDiscussionAnchor(scope, occurrence, 'planned-ex'), executionDiscussionAnchor(scope, session, exercise)],
      [anchor, executionDiscussionAnchor(scope, session, exercise, set)],
    ]) expect(discussionAnchorKey(scope, before)).toBe(discussionAnchorKey(scope, after));
  });
  it('ignores position, names and logical deletion, preserving stored context after source disappearance', () => {
    const changed = { ...session, name: 'renamed', deletedAt: time };
    const changedExercise = { ...exercise, position: 9, deletedAt: time };
    const changedSet = { ...set, position: 7 };
    expect(executionDiscussionAnchor(scope, changed, changedExercise, changedSet)).toEqual(anchor);
    expect(discussionParents(thread.anchor)).toHaveLength(2);
    expect(discussionAnchorKey(thread, thread.anchor)).toBe(thread.anchorKey);
  });
  it('keeps new execution rows and ad-hoc/legacy namespaces distinct without guessing by catalogue ID', () => {
    const newExercise = { ...exercise, occurrenceExerciseId: undefined };
    const newSet = { ...set, occurrenceSetId: undefined };
    const actual = executionDiscussionAnchor(scope, session, newExercise, newSet);
    expect(discussionAnchorKey(scope, actual)).not.toBe(thread.anchorKey);
    const adhoc = executionDiscussionAnchor(scope, { ...session, occurrenceId: undefined, occurrencePlan: undefined }, newExercise, newSet);
    const legacySession = { id: session.id, realmId: scope.realmId };
    const legacy = legacyDiscussionAnchor(scope, legacySession);
    expect(discussionAnchorKey(scope, adhoc)).not.toBe(discussionAnchorKey(scope, legacy));
    const le = { id: exercise.id, realmId: scope.realmId, workoutSessionId: session.id };
    expect(legacyFactDiscussionAnchor(scope, legacySession, le)).not.toEqual(legacyDiscussionAnchor(scope, legacySession, le));
  });
  it('rejects foreign realms, substituted parents and nonexistent provenance', () => {
    expect(() => executionDiscussionAnchor(scope, { ...session, realmId: 'pair-b' }, exercise, set)).toThrow();
    expect(() => executionDiscussionAnchor(scope, session, exercise, { ...set, exerciseId: 'other-ex' })).toThrow();
    expect(() => executionDiscussionAnchor(scope, session, { ...exercise, occurrenceExerciseId: 'catalogue' })).toThrow();
    expect(() => occurrenceDiscussionAnchor(scope, occurrence, 'catalogue')).toThrow();
    expect(() => occurrenceDiscussionAnchor(scope, occurrence, 'planned-ex', 'another-set')).toThrow();
  });
  it('allows only whole-program anchors and validates automatic entity/date titles', () => {
    for (const kind of ['phase', 'day', 'programExercise', 'programSet']) expect(isDiscussionAnchor({ kind, id: 'x' })).toBe(false);
    expect(isDiscussionAnchor({ kind: 'program', trainingPlanId: 'program' })).toBe(true);
    expect(discussionTitle(' Squat ', '2026-11-06')).toBe('Squat · 2026-11-06');
    expect(() => discussionTitle('Squat', '2026-02-31')).toThrow();
  });
  it('isolates the same source ID in different pairs and the personal history from a later relationship', () => {
    const personal = { realmId: 'tg:2', coachClientId: null };
    const other = { realmId: 'pair-b', coachClientId: 'pair-b' };
    expect(discussionAnchorKey(scope, anchor)).not.toBe(discussionAnchorKey(other, anchor));
    expect(discussionAnchorKey(scope, anchor)).not.toBe(discussionAnchorKey(personal, anchor));
  });
});

describe('normal application write contracts (not live cloud ACL verification)', () => {
  it('permits own edits/tombstones and rejects another author or provenance changes', () => {
    expect(() => assertDiscussionMessageWrite('tg:1', thread, { ...message, text: 'edited', editedAt: time }, message)).not.toThrow();
    expect(() => assertDiscussionMessageWrite('tg:1', thread, { ...message, text: '', deletedAt: time }, message)).not.toThrow();
    for (const patch of [{ authorUserId: 'tg:2' }, { owner: 'tg:2' }, { threadId: 'other' }, { realmId: 'pair-b' }])
      expect(() => assertDiscussionMessageWrite('tg:1', thread, { ...message, ...patch }, message)).toThrow();
    expect(() => assertDiscussionMessageWrite('tg:2', thread, message, message)).toThrow();
  });
  it('permits replies only to the same thread/realm, including a deleted source placeholder', () => {
    const reply = { ...message, id: 'reply', replyToMessageId: message.id };
    expect(() => assertDiscussionMessageWrite('tg:1', thread, reply, undefined, { ...message, text: '', deletedAt: time })).not.toThrow();
    expect(() => assertDiscussionMessageWrite('tg:1', thread, reply, undefined, { ...message, threadId: 'foreign' })).toThrow();
    expect(() => assertDiscussionMessageWrite('tg:1', thread, reply, undefined)).toThrow();
  });
  it('shares a read-state identity across two devices of one user, without granting access to another user', () => {
    const id = discussionReadStateId(scope.realmId, thread.id, 'tg:1');
    expect(discussionReadStateId(scope.realmId, thread.id, 'tg:1')).toBe(id);
    const state = { id, realmId: scope.realmId, threadId: thread.id, owner: 'tg:1', userId: 'tg:1', lastReadAt: time, lastReadMessageId: message.id };
    expect(() => assertDiscussionReadStateWrite('tg:1', thread, state, message)).not.toThrow();
    expect(() => assertDiscussionReadStateWrite('tg:2', thread, state, message)).toThrow();
    expect(() => assertDiscussionReadStateWrite('tg:1', thread, state, { ...message, threadId: 'other' })).toThrow();
  });
});
