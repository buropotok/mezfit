import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { localScheduleInstant } from '../../schedule/calendar-time';

/** A bounded, materialized series: the source occurrence is its first occurrence. */
export interface WorkoutRepeatRule {
  /** JavaScript local weekdays: Sunday=0, Monday=1, ..., Saturday=6. */
  weekdays: number[];
  /** Horizon measured from the source day, including the source week. */
  weeks: 2 | 3 | 4;
}

export function isWorkoutRepeatRule(value: unknown): value is WorkoutRepeatRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rule = value as Partial<WorkoutRepeatRule>;
  return (rule.weeks === 2 || rule.weeks === 3 || rule.weeks === 4)
    && Array.isArray(rule.weekdays) && rule.weekdays.length > 0 && rule.weekdays.length <= 7
    && rule.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(rule.weekdays).size === rule.weekdays.length;
}

export function defaultWorkoutRepeatRule(startsAtUtc: string): WorkoutRepeatRule {
  return { weekdays: [new Date(startsAtUtc).getDay()], weeks: 4 };
}

/** Recurrence follows local wall-clock dates, not 24-hour UTC offsets. */
export function repeatWorkoutStarts(startsAtUtc: string, rule: WorkoutRepeatRule): string[] {
  const start = new Date(startsAtUtc);
  if (!Number.isFinite(start.getTime()) || !isWorkoutRepeatRule(rule))
    throw new Error('Некорректные параметры повторения');
  const time = [start.getHours(), start.getMinutes()].map(value => String(value).padStart(2, '0')).join(':');
  const result: string[] = [];
  // Day zero is the source. A fixed horizon bounds synced writes to at most 27.
  for (let offset = 1; offset < rule.weeks * 7; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 12);
    if (!rule.weekdays.includes(date.getDay())) continue;
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-');
    result.push(localScheduleInstant(day, time));
  }
  if (!result.length) throw new Error('Выберите дни, на которые повторится тренировка');
  return result;
}

/** Each copy owns its PLAN structure and cannot mutate the source workout's set IDs. */
export function duplicateWorkoutPlan(plan: WorkoutOccurrencePlan): WorkoutOccurrencePlan {
  return { ...structuredClone(plan), exercises: plan.exercises.map(exercise => ({
    ...structuredClone(exercise), id: crypto.randomUUID(),
    sets: exercise.sets.map(set => ({ ...structuredClone(set), id: crypto.randomUUID() })),
  })) };
}
