import type { CloudTrainingPlanRow } from './database';
import type { CloudProgramPhaseRow } from './workout-foundation-types';

/**
 * New assigned PLAN records explicitly set owner:null so access follows the
 * relationship ACL, not implicit per-object owner privileges. Personal PLAN
 * remains author-owned. Legacy coach-owned PLAN rows stay readable.
 * Client-owned PLAN rows in relationship realms are always invalid.
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
