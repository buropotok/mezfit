import type { SourceWorkoutTiming } from '../worker/processor/source-package/types';
import type { CalendarOccupancySnapshot, ImportTime, IssueCode } from './types';

const DAY_MINUTES = 1440;
export function isReliableTimeZone(value: string | null): value is string {
  if (!value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}
function utcForLocal(date: string, minute: number, zone: string): string | null {
  const [y, m, d] = date.split('-').map(Number);
  const local = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const wanted = [y, m, d, Math.floor(minute / 60), minute % 60].join(',');
  // Probe standard IANA offsets in 15-minute increments, including historical half-hour offsets.
  // Prefer the earlier UTC instant when local wall time is repeated by a DST fold.
  for (let offset = 14 * 60; offset >= -14 * 60; offset -= 15) {
    const ms = local - offset * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    const found = [Number(parts.year), Number(parts.month), Number(parts.day),
      Number(parts.hour), Number(parts.minute)].join(',');
    if (found === wanted) return new Date(ms).toISOString();
  }
  return null;
}
function occupies(start: string, spans: readonly { startsAtUtc: string; endsAtUtc: string }[]): boolean {
  const point = Date.parse(start);
  return spans.some(x => Date.parse(x.startsAtUtc) <= point && point < Date.parse(x.endsAtUtc));
}

/** Proposes a local wall-clock slot; NEVER fabricates source duration or completion. */
export function mapTiming(
  value: SourceWorkoutTiming,
  evaluatedAtUtc: string,
  category: 'session' | 'scheduled',
  occupancy: CalendarOccupancySnapshot['intervals'],
  proposed: string[],
): { timing: ImportTime; issues: IssueCode[] } {
  const issues: IssueCode[] = [];
  if (value.timeZone !== null && !isReliableTimeZone(value.timeZone)) issues.push('UNKNOWN_SOURCE_TIMEZONE');
  let start = value.startedAtUtc;
  let end = category === 'session' ? value.completedAtUtc : null;
  let inferred = false;
  if (value.precision === 'date' && value.localDate) {
    if (!isReliableTimeZone(value.timeZone)) {
      if (!issues.includes('UNKNOWN_SOURCE_TIMEZONE')) issues.push('UNKNOWN_SOURCE_TIMEZONE');
    } else {
      for (let minute = 8 * 60; minute < DAY_MINUTES; minute += 30) {
        const slot = utcForLocal(value.localDate, minute, value.timeZone);
        if (!slot) continue;
        if (occupies(slot, occupancy) || proposed.includes(slot)) continue;
        start = slot;
        proposed.push(slot);
        inferred = true;
        issues.push('TIME_INFERRED');
        break;
      }
      if (!start) issues.push('TIME_SLOT_EXHAUSTED');
    }
  }
  if (!value.localDate) issues.push('UNKNOWN_BUSINESS_DATE');
  if (category === 'session' && !end) issues.push('TIME_DURATION_UNKNOWN');
  if (category === 'scheduled') {
    // SourceWorkoutTiming.completedAtUtc is not an evidenced scheduled endsAt.
    // Without a scheduled end/duration in SourceImportPackage v1, missed is unknown.
    issues.push('SCHEDULE_END_UNKNOWN');
  }
  if (start && occupies(start, occupancy) && category === 'scheduled') issues.push('TIME_COLLISION');
  if (!start) issues.push('TIME_DURATION_UNKNOWN');
  const missed: ImportTime['missed'] = category === 'session'
    ? 'not_applicable' : end ? (Date.parse(end) < Date.parse(evaluatedAtUtc) ? 'missed' : 'not_missed') : 'undetermined';
  return {
    timing: { source: value, proposedStartsAtUtc: start, proposedEndsAtUtc: end,
      importTimeInferred: inferred, missed },
    issues: [...new Set(issues)],
  };
}
