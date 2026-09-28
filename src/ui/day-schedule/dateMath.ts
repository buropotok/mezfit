import { formatLocalDate, parseLocalDate, type LocalDate } from '../date-picker/datePickerDate';

export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const MONTH_LABELS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function toDate(value: LocalDate): CalendarDate {
  const parsed = parseLocalDate(value);
  if (!parsed) throw new Error('DaySchedule date must be a valid YYYY-MM-DD local date');
  return parsed;
}

function toUtcDate(value: LocalDate): Date {
  const date = toDate(value);
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcDate(date: Date): LocalDate {
  return formatLocalDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(value: LocalDate, amount: number): LocalDate {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return fromUtcDate(date);
}

export function startOfWeek(value: LocalDate): LocalDate {
  const date = toUtcDate(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return fromUtcDate(date);
}

export function dayIndex(value: LocalDate): number {
  return (toUtcDate(value).getUTCDay() + 6) % 7;
}

export function sameWeek(a: LocalDate, b: LocalDate): boolean {
  return startOfWeek(a) === startOfWeek(b);
}

export function titleForDate(value: LocalDate, today: LocalDate): string {
  if (value === today) return 'Сегодня';
  const parsed = toDate(value);
  return `${WEEKDAY_LABELS[dayIndex(value)]}, ${parsed.day} ${MONTH_LABELS[parsed.month - 1]}`;
}

export function currentLocalDate(): LocalDate {
  const now = new Date();
  return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
