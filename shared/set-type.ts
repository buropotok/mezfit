/** Specialized set techniques. An ordinary set has no selected type (null). */
export const SET_TYPES = [
  'dropset', 'isometrics', 'cluster', 'rest_pause', 'tempo_superset', 'partial_reps',
] as const;

export type SetType = (typeof SET_TYPES)[number];

export const SET_TYPE_LABELS: Record<SetType, string> = {
  dropset: 'Дропсет',
  isometrics: 'Изометроника',
  cluster: 'Кластер',
  rest_pause: 'Отдых-Пауза',
  tempo_superset: 'Темповый суперсет',
  partial_reps: 'Частичные повторения',
};

export function isSetType(value: unknown): value is SetType {
  return typeof value === 'string' && SET_TYPES.some(type => type === value);
}
