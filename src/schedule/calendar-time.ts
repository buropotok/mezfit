/** Local calendar projection. UTC remains the stored source of truth. */
export function calendarDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
}
export function calendarTime(date: Date): string {
  return [date.getHours(), date.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
}

/** Reject both missing and repeated local times rather than silently choosing an offset. */
export function localScheduleInstant(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const instant = new Date(year, month - 1, day, hours, minutes);
  if (!Number.isFinite(instant.getTime()) || calendarDate(instant) !== date || calendarTime(instant) !== time)
    throw new Error('Это местное время недоступно из-за перевода часов');
  const offsets = new Set([-2, -1, 0, 1, 2].map(days =>
    new Date(instant.getTime() + days * 86_400_000).getTimezoneOffset()));
  for (const offset of offsets) {
    const other = new Date(instant.getTime() + (offset - instant.getTimezoneOffset()) * 60_000);
    if (other.getTime() !== instant.getTime()
      && calendarDate(other) === date && calendarTime(other) === time)
      throw new Error('Это время повторяется при переводе часов. Выберите другое время');
  }
  return instant.toISOString();
}

export function localScheduleEnd(start: Date, time: string): string {
  const next = new Date(start);
  // Choose the calendar day before converting to UTC: local days need not be 24 hours.
  if (time <= calendarTime(start)) next.setDate(next.getDate() + 1);
  return localScheduleInstant(calendarDate(next), time);
}

export function calendarSegments(startsAtUtc: string, durationMinutes: number): Array<{
  date: string; startMinutes: number; durationMinutes: number;
}> {
  const end = Date.parse(startsAtUtc) + durationMinutes * 60_000;
  const segments = [];
  let from = new Date(startsAtUtc);
  while (from.getTime() < end) {
    const midnight = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    const until = Math.min(end, midnight.getTime());
    const startMinutes = from.getHours() * 60 + from.getMinutes();
    segments.push({ date: calendarDate(from), startMinutes,
      durationMinutes: (until - from.getTime()) / 60_000 });
    from = new Date(until);
  }
  return segments;
}
