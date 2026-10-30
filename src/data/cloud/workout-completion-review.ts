import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import { bookingsOverlap } from './workout-slot-validation';

const tables = ['adHocSessions', 'workoutOccurrences', 'localWorkoutSync', 'realms', 'members'];

/** Only unresolved calendar PLAN rows sharing an athlete or a coached participant. */
export function completedWorkoutOverlaps(
  completed: { occurrenceId?: string; athleteUserId: string; coachUserId: string | null;
    format: 'coached' | 'independent'; startedAt: string; completedAt: string | null },
  rows: readonly CloudWorkoutOccurrenceRow[],
): CloudWorkoutOccurrenceRow[] {
  const durationMinutes = (Date.parse(completed.completedAt ?? '') - Date.parse(completed.startedAt)) / 60_000;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
  const actual = { ...completed, startsAtUtc: completed.startedAt, durationMinutes };
  return rows.filter(row => row.id !== completed.occurrenceId && row.entryKind !== 'personal_event'
    && !row.inactive && !row.cancelledAt && row.status === 'scheduled' && !row.workoutSessionId
    && row.publicationStatus !== 'draft' && bookingsOverlap(actual, row))
    .sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc) || a.id.localeCompare(b.id));
}

/** Local reads/actions only. Completion itself is saved independently before this review. */
export class WorkoutCompletionReviewRepository {
  private readonly sessions: AdHocWorkoutRepository;
  private readonly drafts: WorkoutOccurrenceDraftRepository;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    this.sessions = new AdHocWorkoutRepository(db, actorUserId);
    this.drafts = new WorkoutOccurrenceDraftRepository(db, actorUserId);
  }
  private async completed(sessionId: string) {
    const session = await this.sessions.getRow(sessionId);
    if (!session || session.status !== 'completed' || !session.completedAt
      || (session.creatorUserId !== this.actorUserId && session.coachUserId !== this.actorUserId))
      throw new Error('Завершённая тренировка недоступна');
    const occurrence = session.occurrenceId ? await this.db.workoutOccurrences.get(session.occurrenceId) : null;
    return { ...session, format: occurrence && occurrence.realmId === session.realmId
      && occurrence.workoutSessionId === session.id ? occurrence.format
      : session.coachUserId ? 'coached' as const : 'independent' as const };
  }
  private async rows(sessionId: string) {
    const completed = await this.completed(sessionId);
    const rows = await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace();
    // A stale scheduled row linked to an execution must never offer cancel/move.
    const executions = await this.sessions.listForCalendar();
    const linked = new Set(executions.flatMap(row => row.occurrenceId ? [row.occurrenceId] : []));
    return completedWorkoutOverlaps(completed, rows).filter(row => !linked.has(row.id));
  }
  list(sessionId: string): Promise<CloudWorkoutOccurrenceRow[]> {
    return this.db.transaction('r', tables, async () => this.rows(sessionId));
  }
  observe(sessionId: string, next: (rows: CloudWorkoutOccurrenceRow[]) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.list(sessionId)).subscribe({ next, error });
  }
  async cancel(sessionId: string, occurrenceId: string): Promise<void> {
    await this.drafts.flushEdits('draft:' + occurrenceId);
    await this.db.transaction('rw', tables, async () => {
      if (!(await this.rows(sessionId)).some(row => row.id === occurrenceId))
        throw new Error('Пересечение больше недоступно. Список обновится автоматически');
      await this.drafts.cancel(occurrenceId);
    });
  }
  async move(sessionId: string, occurrenceId: string, startsAtUtc: string): Promise<void> {
    await this.drafts.flushEdits('draft:' + occurrenceId);
    await this.db.transaction('rw', tables, async () => {
      const row = (await this.rows(sessionId)).find(row => row.id === occurrenceId);
      if (!row) throw new Error('Пересечение больше недоступно. Список обновится автоматически');
      if (completedWorkoutOverlaps(await this.completed(sessionId), [{ ...row, startsAtUtc }]).length)
        throw new Error('Выберите время вне завершённой тренировки');
      await this.drafts.edit('draft:' + occurrenceId, current => ({ ...current, startsAtUtc }));
    });
  }
}
