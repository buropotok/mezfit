import type { SourceWorkoutTiming } from '../worker/processor/source-package/types';
import type { ImportConfig, IssueCode, MappedTiming } from './contracts';

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
export type Interval = readonly [number, number];

function localClock(ms: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = new Map(formatter.formatToParts(ms).map(({ type, value }) => [type, value]));
  const year = parts.get('year')?.padStart(4, '0');
  return `${year}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`;
}

export function businessDate(timing: SourceWorkoutTiming): { date: string | null; issue: IssueCode | null } {
  const exact = timing.precision === 'minute' || timing.precision === 'instant';
  const stamp = timing.startedAtUtc ?? timing.completedAtUtc;
  const derived = exact && stamp && timing.timeZone
    ? localClock(Date.parse(stamp), timing.timeZone).slice(0, 10) : null;
  if (timing.localDate && derived && timing.localDate !== derived) return { date: null, issue: 'INCONSISTENT_DATE' };
  const date = timing.localDate ?? derived;
  return { date, issue: date ? null : 'UNKNOWN_DATE' };
}

function slots(date: string, zone: string): Interval[] {
  const base = Date.parse(date);
  const offsets = new Set<number>();
  // Sample both sides of a transition, then verify each candidate against the
  // local clock. A duplicated or skipped clock boundary cannot allocate a slot.
  for (let hour = -36; hour <= 48; hour += 6) {
    const stamp = base + hour * HOUR;
    offsets.add(Date.parse(localClock(stamp, zone) + 'Z') - stamp);
  }
  const resolve = (wall: number) => [...offsets].map(offset => wall - offset)
    .filter(candidate => localClock(candidate, zone) === iso(wall).slice(0, 19));
  const result: Interval[] = [];
  for (let hour = 8; hour < 24; hour++) {
    const [start, ...ambiguousStarts] = resolve(base + hour * HOUR);
    const [end, ...ambiguousEnds] = resolve(base + (hour + 1) * HOUR);
    if (start !== undefined && end !== undefined && end - start === HOUR && !ambiguousStarts.length && !ambiguousEnds.length) {
      result.push([start, end]);
    }
  }
  return result;
}

export function exactStart(timing: SourceWorkoutTiming): number | null {
  return (timing.precision === 'minute' || timing.precision === 'instant') && timing.startedAtUtc
    ? Date.parse(timing.startedAtUtc) : null;
}

export function calendar(snapshot: ImportConfig['occupancySnapshot'], known: Interval[], knownStarts: number[]) {
  const busy = [...known, ...(snapshot ?? []).map(({ startsAtUtc, endsAtUtc }): Interval =>
    [Date.parse(startsAtUtc), Date.parse(endsAtUtc)])];
  const cachedSlots = new Map<string, Interval[]>();

  return (original: SourceWorkoutTiming, date: string, reserve: boolean): { timing: MappedTiming; issue: IssueCode | null } => {
    const exact = exactStart(original);
    const timing: MappedTiming = { original, businessDate: date, proposedStartUtc: exact === null ? null : iso(exact),
      allocationEndsAtUtc: null, importTimeInferred: false };
    if (exact !== null) return { timing, issue: null };
    if (original.precision !== 'date') return { timing, issue: 'UNKNOWN_START' };
    if (!original.timeZone) return { timing, issue: 'UNKNOWN_TIME_ZONE' };
    if (snapshot === null) return { timing, issue: 'OCCUPANCY_UNRESOLVED' };
    const key = date + '/' + original.timeZone;
    const candidates = cachedSlots.get(key) ?? slots(date, original.timeZone);
    cachedSlots.set(key, candidates);
    const slot = candidates.find(([start, end]) => !busy.some(([a, b]) => a < end && start < b)
      && !knownStarts.some(stamp => start <= stamp && stamp < end));
    if (!slot) return { timing, issue: 'NO_FREE_SLOT' };
    if (reserve) busy.push(slot);
    return { timing: { ...timing, proposedStartUtc: iso(slot[0]), allocationEndsAtUtc: iso(slot[1]),
      importTimeInferred: true }, issue: null };
  };
}
