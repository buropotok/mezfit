import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from './workout-scheduling';

export interface UpcomingPlannedWorkout {
  id: string;
  draft: LocalWorkoutOccurrenceDraft;
  programName: string | null;
}

/** One range shared by all card projections, using local calendar days across DST. */
export function plannedWorkoutRange(reference: Date): { from: number; until: number } {
  if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) throw new Error('INVALID_PLANNED_WORKOUT_RANGE');
  const from = new Date(reference);
  from.setHours(0, 0, 0, 0);
  const until = new Date(from);
  until.setDate(until.getDate() + 14);
  return { from: from.getTime(), until: until.getTime() };
}

/** Read projections only; the card edits the original synchronized occurrence. */
export class PlannedWorkoutsRepository {
  readonly drafts: WorkoutOccurrenceDraftRepository;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    this.drafts = new WorkoutOccurrenceDraftRepository(db, actorUserId);
  }
  async list(reference = new Date()): Promise<UpcomingPlannedWorkout[]> {
    const { from, until } = plannedWorkoutRange(reference);
    const rows = await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace();
    const result: UpcomingPlannedWorkout[] = [];
    for (const row of rows) {
      const start = Date.parse(row.startsAtUtc);
      if (row.entryKind === 'personal_event' || row.status !== 'scheduled' || row.workoutSessionId
        || row.cancelledAt || start < from || start >= until
        || (row.coachUserId ? row.coachUserId !== this.actorUserId
          : row.realmId !== this.actorUserId || row.athleteUserId !== this.actorUserId)) continue;
      const draft = await this.drafts.get('draft:' + row.id);
      if (!draft || draft.workoutSessionId || (draft.executionStatus && draft.executionStatus !== 'scheduled')) continue;
      const program = row.trainingPlanId ? await this.db.trainingPlans.get(row.trainingPlanId) : null;
      result.push({ id: row.id, draft, programName: program?.realmId === row.realmId ? program.name : null });
    }
    return result.sort((a, b) => a.draft.startsAtUtc.localeCompare(b.draft.startsAtUtc) || a.id.localeCompare(b.id));
  }
  observe(reference: Date, next: (rows: UpcomingPlannedWorkout[]) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.list(reference)).subscribe({ next, error });
  }
}
