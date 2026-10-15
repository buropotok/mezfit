import type { CloudTrainingPlanRow } from './database';
import type { CloudProgramPhaseRow } from './workout-foundation-types';

/**
 * Dexie Cloud Addon's implicit owner setter may assign a new PLAN header to
 * the actor even when add() was supplied owner:null. Ownership is therefore
 * intentional and limited to the authorized author of this PLAN scope.
 *
 * Personal plans: only the athlete; relationship plans: only the coach.
 * Existing Worker-provisioned ownerless headers remain compatible.
 * A Client-owned header in a coach realm is not a valid assigned PLAN.
 */
export function planAuthorUserId(plan: CloudTrainingPlanRow): string | null {
  if (plan.coachUserId === null && plan.clientUserId === null) {
    return plan.athleteUserId ?? null;
  }
  return plan.coachUserId;
}

export function isExpectedPlanOwner(plan: CloudTrainingPlanRow): boolean {
  const author = planAuthorUserId(plan);
  return plan.owner === null || (author !== null && plan.owner === author);
}

export function isExpectedPhaseOwner(
  phase: CloudProgramPhaseRow, plan: CloudTrainingPlanRow,
): boolean {
  const author = planAuthorUserId(plan);
  return phase.owner === null || (author !== null && phase.owner === author);
}
