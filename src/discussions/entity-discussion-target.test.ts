import { describe, expect, it } from 'vitest';
import { programDiscussionTarget, plannedDiscussionTarget } from './entity-discussion-target';
import { executionDiscussionAnchor } from '../data/cloud/discussion-anchors';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { discussionAnchorKey } from '../../shared/discussion-anchor';

const program: CloudTrainingPlanRow = { id: 'program', realmId: 'pair-a', owner: null,
  coachUserId: 'tg:11', clientUserId: 'tg:22', athleteUserId: 'tg:22', name: 'Силовая',
  position: 0, status: 'active', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' };
const plan = { name: 'День А', comment: 'Предписание тренера', exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:occurrence', actorUserId: 'tg:11', realmId: 'pair-a',
  athleteUserId: 'tg:22', coachUserId: 'tg:11', clientUserId: 'tg:22', format: 'coached',
  plan, originalPlan: structuredClone(plan), startsAtUtc: '2026-11-07T10:00:00.000Z',
  durationMinutes: 60, createdAt: '', updatedAt: '', executionStatus: 'scheduled' };

describe('COMM-06 targets preserve source identity and PLAN', () => {
  it('has only the root program anchor for either participant and keeps trainer realms isolated', () => {
    const coach = programDiscussionTarget(program, 'tg:11'), client = programDiscussionTarget(program, 'tg:22');
    expect(coach).toEqual(client);
    expect(coach.anchor).toEqual({ kind: 'program', trainingPlanId: 'program' });
    const other = programDiscussionTarget({ ...program, realmId: 'pair-b', coachUserId: 'tg:33' }, 'tg:22');
    expect(discussionAnchorKey(coach.scope, coach.anchor)).not.toBe(discussionAnchorKey(other.scope, other.anchor));
    const personal = programDiscussionTarget({ ...program, realmId: 'tg:22', coachUserId: null, clientUserId: null }, 'tg:22');
    expect(personal.scope).toEqual({ realmId: 'tg:22', coachClientId: null });
  });
  it('uses the canonical occurrence and the existing execution alias without mutating any PLAN data', () => {
    const before = structuredClone(draft);
    const target = plannedDiscussionTarget(draft);
    expect(target?.anchor).toEqual({ kind: 'workout', workout: { kind: 'occurrence', id: 'occurrence' } });
    expect(target?.anchor).toEqual(executionDiscussionAnchor({ realmId: 'pair-a', coachClientId: 'pair-a' },
      { id: 'session', realmId: 'pair-a', occurrenceId: 'occurrence', occurrencePlan: plan }));
    expect(plannedDiscussionTarget({ ...draft, targetOccurrenceId: 'exact-occurrence' })?.anchor)
      .toEqual({ kind: 'workout', workout: { kind: 'occurrence', id: 'exact-occurrence' } });
    expect(draft).toEqual(before);
  });
  it('keeps the same occurrence entry after Start and completion', () => {
    const expected = plannedDiscussionTarget(draft);
    expect(plannedDiscussionTarget({ ...draft, workoutSessionId: 'session' })).toEqual(expected);
    expect(plannedDiscussionTarget({ ...draft, executionStatus: 'in_progress' })).toEqual(expected);
    expect(plannedDiscussionTarget({ ...draft, executionStatus: 'completed' })).toEqual(expected);
  });
});
