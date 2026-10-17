import { liveQuery } from 'dexie';
import { readProgramDays } from './program-day-tree';
import { isApprovedAssignedPair } from './assigned-programs';
import { isExpectedPlanOwner, isExpectedPhaseOwner } from './program-ownership';
import type { MezfitCloudDatabase } from './database';
import type { CloudProgramOutline } from './workout-foundation-types';

function ordered<T extends { id: string; position: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Read-only workout-domain projection. ProgramManagementRepository owns PLAN
 * authoring; both readers share descendant ownership and tombstone rules.
 */
export class WorkoutFoundationRepository {
  constructor(
    private readonly db: MezfitCloudDatabase,
    private readonly actorUserId: string,
  ) {}

  async getProgramOutline(programId: string): Promise<CloudProgramOutline | null> {
    if (!programId || !/^tg:[1-9]\d*$/.test(this.actorUserId)) return null;
    const plan = await this.db.trainingPlans.get(programId);
    if (!plan || plan.deletedAt || !isExpectedPlanOwner(plan)) return null;
    const personal = plan.realmId === this.actorUserId
      && plan.athleteUserId === this.actorUserId
      && plan.coachUserId === null && plan.clientUserId === null;
    if (!personal && (plan.coachUserId !== this.actorUserId
      && plan.clientUserId !== this.actorUserId)) return null;
    if (!personal) {
      if (!plan.coachUserId || !plan.clientUserId) return null;
      const [realm, members] = await Promise.all([
        this.db.realms.get(plan.realmId),
        this.db.members.where('realmId').equals(plan.realmId).toArray(),
      ]);
      if (!await isApprovedAssignedPair(realm, members, plan.coachUserId, plan.clientUserId)) {
        return null;
      }
    }

    const phaseRows = await this.db.programPhases.where('realmId').equals(plan.realmId).toArray();
    const phases = ordered(phaseRows.filter((phase) => !phase.deletedAt
      && phase.trainingPlanId === plan.id && phase.realmId === plan.realmId
      && isExpectedPhaseOwner(phase, plan)));
    const days = await readProgramDays(this.db, plan, phases);
    return {
      planId: plan.id, realmId: plan.realmId,
      phases: phases.map((phase) => ({
        phase, days: days.filter((row) => row.day.programPhaseId === phase.id),
      })),
    };
  }

  observeProgramOutline(
    programId: string,
    onChange: (outline: CloudProgramOutline | null) => void,
    onError: (error: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(() => this.getProgramOutline(programId)).subscribe({
      next: onChange,
      error: onError,
    });
  }
}
