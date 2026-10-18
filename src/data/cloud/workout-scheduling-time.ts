/** Date/time of a workout is local to an explicit IANA time zone. */
export interface ScheduleTiming {
  calendarDate: string;
  startMinute: number;
  durationMinutes: number;
  timeZone: string;
}

export function validateScheduleTiming(value: ScheduleTiming): ScheduleTiming {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.calendarDate);
  if (!match) throw new Error('INVALID_SCHEDULE_DATE');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('INVALID_SCHEDULE_DATE');
  }
  if (!Number.isSafeInteger(value.startMinute) || value.startMinute < 0
    || value.startMinute > 1439 || !Number.isSafeInteger(value.durationMinutes)
    || value.durationMinutes <= 0
    || value.startMinute + value.durationMinutes > 1440) {
    throw new Error('INVALID_SCHEDULE_TIME');
  }
  if (typeof value.timeZone !== 'string' || value.timeZone.length === 0
    || value.timeZone.length > 128) throw new Error('INVALID_SCHEDULE_TIME_ZONE');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value.timeZone });
  } catch {
    throw new Error('INVALID_SCHEDULE_TIME_ZONE');
  }
  return value;
}

/**
 * Convert a wall-clock start to a unique instant. Fall-back-hour ambiguities
 * and spring-forward missing times must be resolved explicitly by future UI,
 * never silently shifted by Date or interpreted in the device time zone.
 */
export function resolveScheduledStart(value: ScheduleTiming): string {
  validateScheduleTiming(value);
  const [year, month, day] = value.calendarDate.split('-').map(Number);
  const hour = Math.floor(value.startMinute / 60), minute = value.startMinute % 60;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const wall = (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp);
    const number = (type: string) => Number(parts.find(part => part.type === type)?.value);
    return [number('year'), number('month'), number('day'), number('hour'), number('minute')];
  };
  const expected = [year, month, day, hour, minute];
  const candidates = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const probe = naiveUtc + hours * 3600000;
    const [y, m, d, h, min] = wall(probe);
    const offset = Date.UTC(y, m - 1, d, h, min) - probe;
    const possible = naiveUtc - offset;
    if (wall(possible).every((part, index) => part === expected[index])) {
      candidates.add(possible);
    }
  }
  if (candidates.size === 0) throw new Error('NONEXISTENT_SCHEDULE_TIME');
  if (candidates.size !== 1) throw new Error('AMBIGUOUS_SCHEDULE_TIME');
  return new Date([...candidates][0]).toISOString();
}
