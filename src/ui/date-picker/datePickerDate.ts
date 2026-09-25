export type LocalDate = string;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface MonthCell {
  day: number | null;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function parseLocalDate(value: LocalDate): LocalDateParts | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month - 1)) return null;

  return { year, month, day };
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function buildMonthGrid(year: number, monthIndex: number): MonthCell[] {
  const firstSundayBasedDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const leadingEmptyCells = (firstSundayBasedDay + 6) % 7;
  const totalDays = daysInMonth(year, monthIndex);
  const cells: MonthCell[] = [];

  for (let index = 0; index < leadingEmptyCells; index += 1) cells.push({ day: null });
  for (let day = 1; day <= totalDays; day += 1) cells.push({ day });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  return cells;
}

export function clampYear(year: number, minYear: number, maxYear: number): number {
  return Math.min(maxYear, Math.max(minYear, year));
}

export function calculateCenteredScrollTop({
  targetOffset,
  targetHeight,
  viewportHeight,
  scrollHeight,
}: {
  targetOffset: number;
  targetHeight: number;
  viewportHeight: number;
  scrollHeight: number;
}): number {
  const desiredTop = targetOffset - ((viewportHeight - targetHeight) / 2);
  const maxTop = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(maxTop, Math.max(0, desiredTop));
}

export function formatMonthName(year: number, monthIndex: number, locale: string): string {
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex, 1)));

  const [first = '', ...rest] = Array.from(label);
  return `${first.toLocaleUpperCase(locale)}${rest.join('')}`;
}

export function formatDayLabel(year: number, monthIndex: number, day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex, day)));
}

export function getWeekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const monday = Date.UTC(2026, 0, 5);

  return Array.from({ length: 7 }, (_, index) => {
    const label = formatter.format(new Date(monday + index * 24 * 60 * 60 * 1000));
    return Array.from(label.toLocaleLowerCase(locale))[0] ?? '';
  });
}
