/** All scheduled instants are persisted in UTC, never in device-local wall time. */
export interface ScheduleTiming {
  /** Exact canonical ISO-8601 UTC instant; lexical order equals chronological order. */
  startsAtUtc: string;
  durationMinutes: number;
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** No offsets or timezone-less strings: every stored timestamp has one representation. */
export function isUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

export function validateScheduleTiming(value: ScheduleTiming): ScheduleTiming {
  if (!isUtcInstant(value?.startsAtUtc)) throw new Error('INVALID_SCHEDULE_START_UTC');
  if (!Number.isSafeInteger(value.durationMinutes)
    || value.durationMinutes < 1 || value.durationMinutes > 1440) {
    throw new Error('INVALID_SCHEDULE_DURATION');
  }
  const end = Date.parse(value.startsAtUtc) + value.durationMinutes * 60000;
  if (!Number.isFinite(end) || end > 8.64e15) throw new Error('INVALID_SCHEDULE_DURATION');
  return value;
}
