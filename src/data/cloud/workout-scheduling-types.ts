import type { CloudSharedRow } from './database';
import { validateScheduleTiming, type ScheduleTiming } from './workout-scheduling-time';

export type WorkoutScheduleFormat = 'independent' | 'coached';
export type WorkoutScheduleAction = 'create' | 'reschedule' | 'cancel';

/**
 * This is an untrusted user intent, NOT a booked workout. Dexie Cloud grants
 * both relationship roles add-only access. A future privileged processor must
 * derive identity from verified auth and independently validate every field.
 */
export interface CloudWorkoutScheduleRequestRow extends CloudSharedRow, ScheduleTiming {
  requestKey: string;
  action: WorkoutScheduleAction;
  trainingPlanId: string;
  programDayId: string;
  targetOccurrenceId: string | null;
  athleteUserId: string;
  coachUserId: string | null;
  format: WorkoutScheduleFormat;
  requestedByUserId: string;
  createdAt: string;
}

export interface CreateWorkoutScheduleRequestInput extends ScheduleTiming {
  /** Stable per user action. Reuse on retries, not for different bookings. */
  requestKey: string;
  trainingPlanId: string;
  programDayId: string;
  format: WorkoutScheduleFormat;
}

const userId = (value: unknown): value is string =>
  typeof value === 'string' && /^tg:[1-9]\d*$/.test(value);

export function isWorkoutScheduleRequestRow(value: unknown): value is CloudWorkoutScheduleRequestRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<CloudWorkoutScheduleRequestRow>;
  let timingValid = false;
  try { validateScheduleTiming(row as ScheduleTiming); timingValid = true; }
  catch { return false; }
  return timingValid && typeof row.id === 'string' && row.id.length > 0
    && typeof row.realmId === 'string' && row.realmId.length > 0
    && row.owner === null
    && typeof row.requestKey === 'string' && row.requestKey.length > 0
    && ['create', 'reschedule', 'cancel'].includes(row.action ?? '')
    && typeof row.trainingPlanId === 'string' && row.trainingPlanId.length > 0
    && typeof row.programDayId === 'string' && row.programDayId.length > 0
    && (row.targetOccurrenceId === null || typeof row.targetOccurrenceId === 'string')
    && userId(row.athleteUserId)
    && (row.coachUserId === null || userId(row.coachUserId))
    && (row.format === 'independent' || row.format === 'coached')
    && userId(row.requestedByUserId)
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    && typeof row.calendarDate === 'string' && typeof row.timeZone === 'string'
    && typeof row.startMinute === 'number' && typeof row.durationMinutes === 'number';
}
