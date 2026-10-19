import { liveQuery } from 'dexie';
import { isApprovedAssignedPair } from './assigned-programs';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { isCloudPlanRow } from './program-management';
import { isExpectedPhaseOwner, isExpectedPlanOwner } from './program-ownership';
import { isUtcInstant, validateScheduleTiming } from './workout-scheduling-time';
import { isWorkoutOccurrencePlan } from './workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

function personal(plan: CloudTrainingPlanRow, actor: string): boolean {
  return plan.realmId === actor && plan.athleteUserId === actor
    && plan.coachUserId === null && plan.clientUserId === null
    && isExpectedPlanOwner(plan);
}

const validCloudUserId = (value: unknown): value is string =>
  typeof value === 'string' && /^tg:[1-9]\d*$/.test(value);

function validOccurrence(value: unknown): value is CloudWorkoutOccurrenceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<CloudWorkoutOccurrenceRow>;
  if (typeof row.id !== 'string' || !row.id
    || typeof row.realmId !== 'string' || !row.realmId
    || (row.owner !== null && row.owner !== row.realmId)
    || (row.cancelledAt !== undefined && row.cancelledAt !== null && !isUtcInstant(row.cancelledAt))
    || typeof row.programDayId !== 'string' || !row.programDayId
    || !isWorkoutOccurrencePlan(row.plan)
    || !validCloudUserId(row.athleteUserId)
    || (row.coachUserId !== null && !validCloudUserId(row.coachUserId))
    || (row.clientUserId !== null && !validCloudUserId(row.clientUserId))
    || (row.workoutSessionId !== null && (typeof row.workoutSessionId !== 'string'
      || !row.workoutSessionId))
    || (row.format !== 'independent' && row.format !== 'coached')
    || (row.format === 'coached' && row.coachUserId === null)
    || !['scheduled', 'in_progress', 'completed', 'cancelled'].includes(row.status ?? '')
    || ((row.status === 'in_progress' || row.status === 'completed')
      && !row.workoutSessionId)
    || (row.status === 'scheduled' && row.workoutSessionId !== null)
    || (row.sourceRequestId !== undefined && row.sourceRequestId !== null
      && (typeof row.sourceRequestId !== 'string' || !row.sourceRequestId))
    || (row.createdByUserId !== undefined && !validCloudUserId(row.createdByUserId))
    || (row.createdAt !== undefined && !isUtcInstant(row.createdAt))
    || (row.updatedAt !== undefined && !isUtcInstant(row.updatedAt))) return false;
  try {
    validateScheduleTiming({
      startsAtUtc: row.startsAtUtc as string,
      durationMinutes: row.durationMinutes as number,
    });
    return true;
  } catch { return false; }
}

/** Calendar reads use the authorized local Dexie working set. */
export type WorkoutOccurrenceView = 'program' | 'calendar';
export class WorkoutSchedulingRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {}

  private async readablePlan(id: string): Promise<CloudTrainingPlanRow> {
    const plan: unknown = await this.db.trainingPlans.get(id);
    if (!isCloudPlanRow(plan) || plan.deletedAt || !isExpectedPlanOwner(plan)) {
      throw new Error('SCHEDULE_PLAN_NOT_FOUND');
    }
    if (personal(plan, this.actorUserId)) return plan;
    if (!plan.coachUserId || !plan.clientUserId
      || (plan.athleteUserId !== undefined && plan.athleteUserId !== plan.clientUserId)
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

  private async visibleDayIds(plan: CloudTrainingPlanRow): Promise<Set<string>> {
    const phases = await this.db.programPhases.where('trainingPlanId').equals(plan.id).toArray();
    const phaseIds = new Set(phases.filter(phase => !phase.deletedAt
      && phase.realmId === plan.realmId && isExpectedPhaseOwner(phase, plan)
      && (personal(plan, this.actorUserId) || this.actorUserId !== plan.clientUserId
        || phase.status !== 'draft')).map(phase => phase.id));
    const days = await this.db.programDays.where('realmId').equals(plan.realmId).toArray();
    return new Set(days.filter(day => phaseIds.has(day.programPhaseId)
      && (day.owner === null || day.owner === (plan.coachUserId ?? plan.athleteUserId)))
      .map(day => day.id));
  }

  /**
   * Explicit viewing context:
   * - program: show an athlete's workouts to both authorized people;
   * - calendar: occupy only the current actor's time. An independent workout
   *   from an assigned client program cannot book the coach's calendar.
   */
  async listOccurrences(trainingPlanId: string, view: WorkoutOccurrenceView): Promise<CloudWorkoutOccurrenceRow[]> {
    if (view !== 'program' && view !== 'calendar') throw new Error('INVALID_SCHEDULE_VIEW');
    const plan = await this.readablePlan(trainingPlanId);
    const dayIds = await this.visibleDayIds(plan);
    const rows = await this.db.workoutOccurrences.where('realmId').equals(plan.realmId).toArray();
    return rows.filter(row => validOccurrence(row) && row.status !== 'cancelled' && !row.cancelledAt
      && dayIds.has(row.programDayId) && row.clientUserId === plan.clientUserId
      && row.athleteUserId === (plan.clientUserId ?? this.actorUserId)
      && row.coachUserId === plan.coachUserId
      && (view !== 'calendar' || this.actorUserId !== plan.coachUserId
        || plan.clientUserId === null || row.format === 'coached'))
      .sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc)
        || a.id.localeCompare(b.id));
  }

  /**
   * Calendar visibility depends on current membership and the immutable occurrence,
   * not on whether its originating program day still exists or remains active.
   */
  async listCalendar(participantUserId = this.actorUserId): Promise<CloudWorkoutOccurrenceRow[]> {
    const [occurrences, realms, members] = await Promise.all([
      this.db.workoutOccurrences.toArray(),
      this.db.realms.toArray(),
      this.db.members.toArray(),
    ]);
    const byRealm = new Map(realms.map(realm => [realm.realmId, realm]));
    const pairKey = (realmId: string, coach: string, client: string) =>
      realmId + ':' + coach + ':' + client;
    const pairs = new Map(occurrences.filter(row => validOccurrence(row)
      && row.coachUserId !== null && row.clientUserId !== null)
      .map(row => [pairKey(row.realmId, row.coachUserId as string, row.clientUserId as string),
        { realmId: row.realmId, coach: row.coachUserId as string, client: row.clientUserId as string }]));
    // Membership verification uses Dexie.waitFor(WebCrypto). Never overlap those
    // waits inside one write transaction (real Addon/WebView can deadlock).
    const allowed = new Set<string>();
    for (const [key, pair] of pairs) {
      if (await isApprovedAssignedPair(byRealm.get(pair.realmId),
        members.filter(member => member.realmId === pair.realmId), pair.coach, pair.client)) allowed.add(key);
    }
    return occurrences.filter(row => {
      if (!validOccurrence(row) || (row.status === 'cancelled' || row.cancelledAt)) return false;
      if (row.coachUserId === null && row.clientUserId === null)
        return row.realmId === this.actorUserId && row.athleteUserId === this.actorUserId
          && row.athleteUserId === participantUserId
          && row.format === 'independent';
      if (!row.coachUserId || !row.clientUserId || row.clientUserId !== row.athleteUserId
        || (row.coachUserId !== this.actorUserId && row.clientUserId !== this.actorUserId)) return false;
      if (!allowed.has(pairKey(row.realmId, row.coachUserId, row.clientUserId))) return false;
      return row.clientUserId === participantUserId
        || (row.coachUserId === participantUserId && row.format === 'coached');
    }).sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc)
      || a.id.localeCompare(b.id));
  }

  observeCalendar(onChange: (rows: CloudWorkoutOccurrenceRow[]) => void,
    onError: (error: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.listCalendar()).subscribe({ next: onChange, error: onError });
  }

  observeOccurrences(trainingPlanId: string, view: WorkoutOccurrenceView,
    onChange: (rows: CloudWorkoutOccurrenceRow[]) => void,
    onError: (error: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.listOccurrences(trainingPlanId, view))
      .subscribe({ next: onChange, error: onError });
  }

  async getOccurrence(trainingPlanId: string, occurrenceId: string,
    view: WorkoutOccurrenceView): Promise<CloudWorkoutOccurrenceRow | null> {
    return (await this.listOccurrences(trainingPlanId, view))
      .find(row => row.id === occurrenceId) ?? null;
  }
}
