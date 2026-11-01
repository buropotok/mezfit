import type { ClientExerciseFact } from '../data/cloud/adhoc-workouts';
import { PUBLIC_EXERCISE_CATEGORIES } from '../data/exercises/publicExerciseFilters';

export type ExercisePeriod = 'all' | '30d' | '3m' | '6m' | 'year' | `year:${number}` | `month:${number}-${number}`;
export type ExerciseMetric = 'reps' | 'sets' | 'volume' | 'weight' | 'oneRepMax'
  | 'workouts' | 'duration' | 'distance';
export type ExerciseSummary = {
  key: string;
  name: string;
  category: string;
  mediaUrl: string | null;
  trackingType: ClientExerciseFact['trackingType'];
  latest: ClientExerciseFact;
  occurrences: readonly ClientExerciseFact[];
  workouts: number;
};

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const offsetMonths = (date: Date, months: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + months, date.getDate());

/** Calendar date and half-open bounds are resolved on the viewing device. */
export function periodBounds(period: ExercisePeriod, today = new Date()): { start: number; end: number; label: string } {
  const current = startOfDay(today);
  const endOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
  if (period === 'all') return { start: -Infinity, end: Infinity, label: 'Весь период' };
  if (period === '30d') return { start: new Date(current.getFullYear(), current.getMonth(), current.getDate() - 29).getTime(), end: endOfToday, label: '30 дней' };
  if (period === '3m' || period === '6m' || period === 'year') {
    const months = period === '3m' ? 3 : period === '6m' ? 6 : 12;
    return { start: offsetMonths(current, -months).getTime(), end: endOfToday,
      label: period === '3m' ? '3 месяца' : period === '6m' ? '6 месяцев' : 'Год' };
  }
  if (period.startsWith('year:')) {
    const year = Number(period.slice(5));
    return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime(),
      label: String(year) };
  }
  const [year, month] = period.slice(6).split('-').map(Number);
  return { start: new Date(year, month - 1, 1).getTime(), end: new Date(year, month, 1).getTime(),
    label: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1)) };
}

export function periodOptions(facts: readonly ClientExerciseFact[], today = new Date()): Array<{ value: ExercisePeriod; label: string }> {
  const base: ExercisePeriod[] = ['30d', '3m', '6m', 'year', 'all'];
  const years = new Set<number>([today.getFullYear()]);
  const months = new Set<string>();
  for (const fact of facts) {
    const date = new Date(fact.startedAt);
    years.add(date.getFullYear());
    months.add(`${date.getFullYear()}-${date.getMonth() + 1}`);
  }
  return [
    ...base.map(value => ({ value, label: periodBounds(value, today).label })),
    ...[...years].sort((a, b) => b - a).map(year => ({
      value: `year:${year}` as ExercisePeriod, label: String(year),
    })),
    ...[...months].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(id => ({
      value: `month:${id}` as ExercisePeriod, label: periodBounds(`month:${id}`, today).label,
    })),
  ];
}

export function filterFacts(facts: readonly ClientExerciseFact[], period: ExercisePeriod, today = new Date()) {
  const { start, end } = periodBounds(period, today);
  return facts.filter(fact => {
    const time = Date.parse(fact.startedAt);
    return Number.isFinite(time) && time >= start && time < end;
  });
}

export function summarizeExercises(facts: readonly ClientExerciseFact[]): ExerciseSummary[] {
  const groups = new Map<string, ClientExerciseFact[]>();
  for (const fact of facts) {
    const items = groups.get(fact.key) ?? [];
    items.push(fact);
    groups.set(fact.key, items);
  }
  return [...groups].map(([key, items]) => {
    const latest = items.reduce((a, b) => a.startedAt >= b.startedAt ? a : b);
    return {
      key, name: latest.name, category: latest.category,
      mediaUrl: latest.mediaUrl, trackingType: latest.trackingType, latest,
      occurrences: items,
      workouts: new Set(items.map(item => item.sessionId)).size,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru-RU') || a.key.localeCompare(b.key));
}

export function radarCategories(facts: readonly ClientExerciseFact[]) {
  const categories = new Map<string, Set<string>>();
  for (const fact of facts) {
    const group = categories.get(fact.category) ?? new Set<string>();
    group.add(`${fact.key}:${fact.sessionId}`);
    categories.set(fact.category, group);
  }
  return PUBLIC_EXERCISE_CATEGORIES.filter(([id]) => categories.has(id)).map(([id, label]) => ({
    category: id, label, count: categories.get(id)?.size ?? 0,
  }));
}

function metricForSession(facts: readonly ClientExerciseFact[], metric: ExerciseMetric): number {
  const sets = facts.flatMap(fact => fact.sets);
  const reps = sets.map(set => set.actualReps ?? 0);
  const weights = sets.map(set => set.actualWeightKg ?? 0);
  const durations = sets.map(set => set.actualDurationSeconds ?? 0);
  const distances = sets.map(set => set.actualDistanceMeters ?? 0);
  switch (metric) {
    case 'reps': return reps.reduce((sum, value) => sum + value, 0);
    case 'sets': return sets.length;
    case 'volume': return sets.reduce((sum, set) => sum + (set.actualReps ?? 0) * (set.actualWeightKg ?? 0), 0);
    case 'weight': return Math.max(0, ...weights);
    case 'oneRepMax': return Math.max(0, ...sets.map(set => (set.actualWeightKg ?? 0)
      * ((set.actualReps ?? 0) <= 1 ? 1 : 1 + (set.actualReps ?? 0) / 30)));
    case 'workouts': return 1;
    case 'duration': return durations.reduce((sum, value) => sum + value, 0);
    case 'distance': return distances.reduce((sum, value) => sum + value, 0);
  }
}

export function exerciseMetric(facts: readonly ClientExerciseFact[], metric: ExerciseMetric): number {
  if (!facts.length) return 0;
  const bySession = new Map<string, ClientExerciseFact[]>();
  for (const fact of facts) {
    const group = bySession.get(fact.sessionId) ?? [];
    group.push(fact);
    bySession.set(fact.sessionId, group);
  }
  const values = [...bySession.values()].map(group => metricForSession(group, metric));
  if (metric === 'weight' || metric === 'oneRepMax') return Math.max(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

export function metricSeries(facts: readonly ClientExerciseFact[], metric: ExerciseMetric) {
  const byDay = new Map<string, ClientExerciseFact[]>();
  for (const fact of facts) {
    const date = new Date(fact.startedAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const group = byDay.get(day) ?? [];
    group.push(fact);
    byDay.set(day, group);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, records]) => ({ day: day.slice(5), value: exerciseMetric(records, metric) }));
}

export function maxWorkoutVolume(facts: readonly ClientExerciseFact[]): number {
  const groups = new Map<string, ClientExerciseFact[]>();
  for (const fact of facts) groups.set(fact.sessionId, [...(groups.get(fact.sessionId) ?? []), fact]);
  return Math.max(0, ...[...groups.values()].map(group => metricForSession(group, 'volume')));
}

export function maxSetReps(facts: readonly ClientExerciseFact[]): number {
  return Math.max(0, ...facts.flatMap(fact => fact.sets.map(set => set.actualReps ?? 0)));
}

export function metricChoices(tracking: ClientExerciseFact['trackingType']): Array<{ id: ExerciseMetric; label: string }> {
  if (tracking === 'time_distance') return [
    { id: 'distance', label: 'Общая дистанция, м' }, { id: 'duration', label: 'Время, с' },
    { id: 'sets', label: 'Подходы' }, { id: 'workouts', label: 'Тренировки' },
  ];
  if (tracking === 'time') return [
    { id: 'duration', label: 'Время, с' }, { id: 'sets', label: 'Подходы' },
    { id: 'workouts', label: 'Тренировки' },
  ];
  if (tracking === 'time_reps') return [
    { id: 'reps', label: 'Повторения' }, { id: 'duration', label: 'Время, с' },
    { id: 'sets', label: 'Подходы' }, { id: 'workouts', label: 'Тренировки' },
  ];
  if (tracking === 'time_weight') return [
    { id: 'weight', label: 'Макс. вес, кг' }, { id: 'duration', label: 'Время, с' },
    { id: 'sets', label: 'Подходы' }, { id: 'workouts', label: 'Тренировки' },
  ];
  return [
    { id: 'reps', label: 'Повторения' }, { id: 'weight', label: 'Макс. вес, кг' },
    { id: 'oneRepMax', label: 'Расчётный 1ПМ, кг' }, { id: 'volume', label: 'Объём, кг' },
    { id: 'sets', label: 'Подходы' }, { id: 'workouts', label: 'Тренировки' },
  ];
}
