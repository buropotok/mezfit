import { liveQuery } from 'dexie';
import { isApprovedAssignedPair } from './assigned-programs';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { isCloudPhaseRow, isCloudPlanRow } from './program-management';
import { isExpectedPhaseOwner, isExpectedPlanOwner } from './program-ownership';
import { isWorkoutScheduleRequestRow, type CloudWorkoutScheduleRequestRow,
  type CreateWorkoutScheduleRequestInput } from './workout-scheduling-types';
import { resolveScheduledStart } from './workout-scheduling-time';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

function personal(plan: CloudTrainingPlanRow, actor: string): boolean {
  return plan.realmId === actor && plan.athleteUserId === actor
    && plan.coachUserId === null && plan.clientUserId === null
    && isExpectedPlanOwner(plan);
}

function validRequestKey(key: string): boolean {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);
}

/** A booking intent is not a reservation; only trusted processing may materialize an occurrence. */
export class WorkoutSchedulingRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {}

  private async readablePlan(id: string): Promise<CloudTrainingPlanRow> {
    const plan: unknown = await this.db.trainingPlans.get(id);
    if (!isCloudPlanRow(plan) || plan.deletedAt || !isExpectedPlanOwner(plan)) {
      throw new Error('SCHEDULE_PLAN_NOT_FOUND');
    }
    if (personal(plan, this.actorUserId)) return plan;
    if (!plan.coachUserId || !plan.clientUserId || plan.athleteUserId !== plan.clientUserId
      || (this.actorUserId !== plan.coachUserId && this.actorUserId !== plan.clientUserId)) {
      throw new Error('SCHEDULE_FORBIDDEN');
    }
    const realm = await this.db.realms.get(plan.realmId);
    const members = await this.db.members.where('realmId').equals(plan.realmId).toArray();
    if (!await isApprovedAssignedPair(realm, members, plan.coachUserId, plan.clientUserId)) {
      throw new Error('SCHEDULE_FORBIDDEN');
    }
    if (this.actorUserId === plan.clientUserId && plan.status === 'draft') {
      throw new Error('SCHEDULE_PLAN_NOT_PUBLISHED');
    }
    return plan;
  }

  private async activeDay(plan: CloudTrainingPlanRow, dayId: string): Promise<void> {
    const day = await this.db.programDays.get(dayId);
    if (!day || day.status !== 'active' || day.realmId !== plan.realmId
      || (day.owner !== null && day.owner !== (plan.coachUserId ?? plan.athleteUserId))) {
      throw new Error('SCHEDULE_DAY_NOT_FOUND');
    }
    const phase: unknown = await this.db.programPhases.get(day.programPhaseId);
    if (!isCloudPhaseRow(phase) || phase.deletedAt || phase.trainingPlanId !== plan.id
      || phase.realmId !== plan.realmId || !isExpectedPhaseOwner(phase, plan)
      || phase.status === 'cancelled') throw new Error('SCHEDULE_DAY_NOT_FOUND');
    if (!personal(plan, this.actorUserId) && this.actorUserId === plan.clientUserId
      && phase.status === 'draft') throw new Error('SCHEDULE_DAY_NOT_PUBLISHED');
  }

  async createRequest(input: CreateWorkoutScheduleRequestInput): Promise<string> {
    if (!validRequestKey(input.requestKey) || typeof input.trainingPlanId !== 'string'
      || !input.trainingPlanId || typeof input.programDayId !== 'string'
      || !input.programDayId || (input.format !== 'independent' && input.format !== 'coached')) {
      throw new Error('INVALID_SCHEDULE_REQUEST');
    }
    // Reject non-existent/ambiguous DST wall-clock instants before a write.
    resolveScheduledStart(input);
    return this.db.transaction('rw', [
      'trainingPlans', 'programPhases', 'programDays', 'realms', 'members',
      'workoutScheduleRequests',
    ], async () => {
      const plan = await this.readablePlan(input.trainingPlanId);
      await this.activeDay(plan, input.programDayId);
      if (input.format === 'coached' && !plan.coachUserId) {
        throw new Error('SCHEDULE_COACH_REQUIRED');
      }
      const athleteUserId = plan.clientUserId ?? this.actorUserId;
      const saved = await this.db.workoutScheduleRequests.where('requestKey')
        .equals(input.requestKey).first();
      const intended = {
        realmId: plan.realmId, owner: null as const, requestKey: input.requestKey,
        action: 'create' as const, trainingPlanId: plan.id, programDayId: input.programDayId,
        targetOccurrenceId: null, athleteUserId, coachUserId: plan.coachUserId,
        format: input.format, requestedByUserId: this.actorUserId,
        calendarDate: input.calendarDate, startMinute: input.startMinute,
        durationMinutes: input.durationMinutes, timeZone: input.timeZone,
      };
      if (saved) {
        if (!isWorkoutScheduleRequestRow(saved)
          || Object.entries(intended).some(([key, value]) =>
            Reflect.get(saved, key) !== value)) throw new Error('SCHEDULE_REQUEST_KEY_CONFLICT');
        return saved.id;
      }
      return this.db.workoutScheduleRequests.add({
        ...intended, createdAt: new Date().toISOString(),
      });
    });
  }

  async listRequests(trainingPlanId: string): Promise<CloudWorkoutScheduleRequestRow[]> {
    const plan = await this.readablePlan(trainingPlanId);
    return (await this.db.workoutScheduleRequests.where('trainingPlanId').equals(plan.id).toArray())
      .filter(row => isWorkoutScheduleRequestRow(row) && row.realmId === plan.realmId
        && row.athleteUserId === (plan.clientUserId ?? this.actorUserId)
        && row.coachUserId === plan.coachUserId
        && (row.requestedByUserId === plan.coachUserId
          || row.requestedByUserId === (plan.clientUserId ?? this.actorUserId)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  observeRequests(trainingPlanId: string, onChange: (rows: CloudWorkoutScheduleRequestRow[]) => void,
    onError: (error: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.listRequests(trainingPlanId)).subscribe({ next: onChange, error: onError });
  }

  async listOccurrences(trainingPlanId: string): Promise<CloudWorkoutOccurrenceRow[]> {
    const plan = await this.readablePlan(trainingPlanId);
    const phases = await this.db.programPhases.where('trainingPlanId').equals(plan.id).toArray();
    const phaseIds = new Set(phases.filter(phase => !phase.deletedAt
      && phase.realmId === plan.realmId && isExpectedPhaseOwner(phase, plan)).map(phase => phase.id));
    const days = await this.db.programDays.where('realmId').equals(plan.realmId).toArray();
    const dayIds = new Set(days.filter(day => phaseIds.has(day.programPhaseId)).map(day => day.id));
    const rows = await this.db.workoutOccurrences.where('realmId').equals(plan.realmId).toArray();
    return rows.filter(row => row.owner === null && dayIds.has(row.programDayId)
      && (row.athleteUserId === undefined || row.athleteUserId === (plan.clientUserId ?? this.actorUserId))
      && (row.coachUserId === plan.coachUserId || (row.coachUserId === null && plan.coachUserId === null)))
      .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate)
        || a.startMinute - b.startMinute || a.id.localeCompare(b.id));
  }

  observeOccurrences(trainingPlanId: string, onChange: (rows: CloudWorkoutOccurrenceRow[]) => void,
    onError: (error: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.listOccurrences(trainingPlanId)).subscribe({ next: onChange, error: onError });
  }

  async getOccurrence(trainingPlanId: string, occurrenceId: string): Promise<CloudWorkoutOccurrenceRow | null> {
    return (await this.listOccurrences(trainingPlanId)).find(row => row.id === occurrenceId) ?? null;
  }
}
