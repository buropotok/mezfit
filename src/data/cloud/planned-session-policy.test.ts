import { describe, expect, it } from 'vitest';
import { occurrencePlanEditRestriction, STARTED_PLAN_MESSAGE } from './planned-session-policy';

const clientIndependent = {
  actorUserId: 'tg:202', athleteUserId: 'tg:202', coachUserId: 'tg:101',
  format: 'independent' as const, workoutSessionId: null, executionStatus: 'scheduled' as const,
};
const coachIndependent = { ...clientIndependent, actorUserId: 'tg:101' };

describe('occurrence PLAN editing policy', () => {
  it('allows Coach and athlete to edit unstarted independent occurrences', () => {
    expect(occurrencePlanEditRestriction(coachIndependent)).toBeNull();
    expect(occurrencePlanEditRestriction(clientIndependent)).toBeNull();
    expect(occurrencePlanEditRestriction({ ...clientIndependent, coachUserId: null })).toBeNull();
  });
  it('keeps coached PLAN Coach-only and foreign users forbidden', () => {
    expect(occurrencePlanEditRestriction({ ...clientIndependent, format: 'coached' }))
      .toContain('только тренер');
    expect(occurrencePlanEditRestriction({ ...coachIndependent, format: 'coached' })).toBeNull();
    expect(occurrencePlanEditRestriction({ ...clientIndependent, actorUserId: 'tg:303' }))
      .toContain('нет прав');
  });
  it('never edits frozen started or completed PLAN regardless of participant or format', () => {
    for (const actor of [coachIndependent, clientIndependent]) {
      expect(occurrencePlanEditRestriction({ ...actor, workoutSessionId: 'session' }))
        .toBe(STARTED_PLAN_MESSAGE);
      expect(occurrencePlanEditRestriction({ ...actor, executionStatus: 'completed' }))
        .toBe(STARTED_PLAN_MESSAGE);
      expect(occurrencePlanEditRestriction({ ...actor, executionStatus: 'in_progress' }))
        .toBe(STARTED_PLAN_MESSAGE);
    }
  });
});
