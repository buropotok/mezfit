import { isExerciseTrackingType, type PublicTaxonomyRow, type ExerciseTrackingType } from './publicExerciseTypes';
import type { CatalogueExerciseRow } from './coachExerciseTypes';

export const PUBLIC_EXERCISE_CATEGORIES = [
  ['chest', 'Грудь'], ['arms', 'Руки'], ['back', 'Спина'],
  ['legs', 'Ноги'], ['shoulders', 'Плечи'], ['core', 'Пресс и корпус'],
  ['full_body', 'Всё тело'], ['cardio', 'Кардио'], ['other', 'Другое'],
] as const;

export type FilterGroup = 'category' | 'equipment' | 'movement_type' | 'muscle'
  // Retained only for previously stored selections and callers. Not exposed in the UI.
  | 'subcategory' | 'all_muscles' | 'primary' | 'secondary' | 'stabilizers'
  | 'emphasis' | 'mobility_targets' | 'zone';
export type SelectedFilters = Partial<Record<FilterGroup, string[]>>;
export type FilterOption = { id: string; label: string };

export const FILTER_GROUPS: ReadonlyArray<{ id: FilterGroup; label: string }> = [
  { id: 'category', label: 'Категория' },
  { id: 'equipment', label: 'Оборудование' },
  { id: 'movement_type', label: 'Тип движения' },
  { id: 'primary', label: 'Основные мышцы' },
  { id: 'secondary', label: 'Вспомогательные мышцы' },
  { id: 'stabilizers', label: 'Стабилизаторы' },
  { id: 'emphasis', label: 'Акцент' },
];
const ALL_GROUPS: readonly FilterGroup[] = [
  ...FILTER_GROUPS.map(({ id }) => id),
  'subcategory', 'all_muscles', 'mobility_targets', 'zone',
];

export const EQUIPMENT_LABELS: Readonly<Record<string, string>> = {
  'body weight': 'Собственный вес', bodyweight: 'Собственный вес',
  'body-weight': 'Собственный вес', 'body only': 'Без оборудования',
  none: 'Без оборудования', 'no equipment': 'Без оборудования',
  barbell: 'Штанга', dumbbell: 'Гантели', dumbbells: 'Гантели',
  cable: 'Тросовый блок', 'cable machine': 'Тросовый тренажёр',
  machine: 'Тренажёр', machines: 'Тренажёр', kettlebell: 'Гиря',
  band: 'Резинка', 'resistance band': 'Резинка',
  'exercise band': 'Резинка', 'smith machine': 'Тренажёр Смита',
  smith: 'Тренажёр Смита', bench: 'Скамья',
  'incline bench': 'Наклонная скамья', 'weight plate': 'Блин',
  plate: 'Блин', plates: 'Блины', 'medicine ball': 'Медбол',
  'stability ball': 'Фитбол', 'exercise ball': 'Фитбол',
  'swiss ball': 'Фитбол', rope: 'Канат', 'jump rope': 'Скакалка',
  'pull-up bar': 'Турник', 'pull up bar': 'Турник',
  'dip bars': 'Брусья', 'parallel bars': 'Брусья',
  'foam roller': 'Массажный ролик', trx: 'Подвесные петли',
  'suspension trainer': 'Подвесные петли', 'ez bar': 'EZ-гриф',
  'ez-bar': 'EZ-гриф', trapbar: 'Трэп-гриф',
  'trap bar': 'Трэп-гриф', landmine: 'Лэндмайн',
  'rowing machine': 'Гребной тренажёр', treadmill: 'Беговая дорожка',
  bike: 'Велотренажёр', 'stationary bike': 'Велотренажёр',
  stepper: 'Степпер', mat: 'Коврик', wall: 'Стена',
  box: 'Платформа', 'plyo box': 'Плиобокс',
  other: 'Другое оборудование',
};
export const MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  resistance: 'Силовые', mobility: 'Подвижность', cardio: 'Кардио',
  strength_or_skill: 'Сила и навык', skill: 'Навык',
};
export const TRACKING_TYPE_LABELS: Record<ExerciseTrackingType, string> = {
  weight_reps: 'Вес и повторения',
  time: 'Время',
  time_distance: 'Время и дистанция',
  time_reps: 'Время и повторения',
  time_weight: 'Время и вес',
};

const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(PUBLIC_EXERCISE_CATEGORIES);
export function exerciseValueLabel(
  group: 'category' | 'equipment' | 'movement_type' | 'tracking_type',
  id: string | undefined,
): string {
  if (!id) return 'Не указано';
  if (group === 'category') return CATEGORY_LABELS[id] ?? 'Другая категория';
  if (group === 'equipment') return EQUIPMENT_LABELS[id] ?? 'Другое оборудование';
  if (group === 'movement_type') return MOVEMENT_LABELS[id] ?? 'Другой тип движения';
  return isExerciseTrackingType(id) ? TRACKING_TYPE_LABELS[id] : 'Другой тип учёта';
}

export function exerciseMuscleLabel(id: string, taxonomy: readonly PublicTaxonomyRow[]): string {
  return taxonomy.find(node => node.id === id)?.subcategory_ru || 'Анатомическая структура';
}

export function normalizeExerciseSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim();
}

function muscleIds(row: CatalogueExerciseRow, group: FilterGroup, zones: ReadonlySet<string>): string[] {
  switch (group) {
    case 'primary': return row.muscles.primary;
    case 'secondary': return row.muscles.secondary;
    case 'stabilizers': return row.muscles.stabilizers;
    case 'emphasis': return row.muscles.emphasis;
    case 'mobility_targets': return row.mobility_targets;
    case 'all_muscles': return [
      ...row.muscles.primary, ...row.muscles.secondary, ...row.muscles.stabilizers,
    ];
    case 'muscle': return [
      ...row.muscles.primary, ...row.muscles.secondary, ...row.muscles.stabilizers,
      ...row.muscles.emphasis, ...row.mobility_targets,
    ];
    case 'zone': return [
      ...row.muscles.primary, ...row.muscles.secondary,
      ...row.muscles.stabilizers, ...row.muscles.emphasis,
      ...row.mobility_targets,
    ].filter(id => zones.has(id));
    default: return [];
  }
}

/** Exact IDs: OR within a group, AND across groups, with no anatomical inference. */
export function filterPublicExercises(
  rows: readonly CatalogueExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  filters: SelectedFilters,
  query: string,
  categoryContext: string | null = null,
): CatalogueExerciseRow[] {
  const search = normalizeExerciseSearch(query);
  const zones = new Set(taxonomy.filter(row => row.kind === 'zone').map(row => row.id));
  const selected = ALL_GROUPS.flatMap(group => filters[group]?.length
    ? [[group, new Set(filters[group])]] as const : []);
  return rows.filter(row => {
    if (categoryContext && row.category !== categoryContext) return false;
    if (search && !normalizeExerciseSearch([
      row.name, row.name_ru, row.name_en, row.subcategory_ru,
    ].join(' ')).includes(search)) return false;
    return selected.every(([group, values]) => {
      if (group === 'category' || group === 'subcategory'
        || group === 'equipment' || group === 'movement_type') {
        return values.has(row[group]);
      }
      return muscleIds(row, group, zones).some(id => values.has(id));
    });
  });
}

/** The same labels serve catalogue cards, filter choices and unsaved editor drafts. */
export function filterOptions(
  group: FilterGroup,
  exercises: readonly CatalogueExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  subcategoryLabels: Readonly<Record<string, string>>,
): FilterOption[] {
  if (group === 'category') return PUBLIC_EXERCISE_CATEGORIES.map(([id, label]) => ({ id, label }));
  if (group === 'muscle' || group === 'zone' || ['all_muscles', 'primary', 'secondary', 'stabilizers', 'emphasis', 'mobility_targets'].includes(group)) {
    const zones = new Set(taxonomy.filter(node => node.kind === 'zone').map(node => node.id));
    const used = new Set(exercises.flatMap(row => muscleIds(row, group, zones)));
    return taxonomy.filter(node => used.has(node.id) && (group !== 'zone' || node.kind === 'zone'))
      .map(node => ({ id: node.id, label: node.subcategory_ru || 'Анатомическая структура' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }
  if (group !== 'subcategory' && group !== 'equipment' && group !== 'movement_type') return [];
  return [...new Set(exercises.map(row => row[group]).filter(Boolean))]
    .map(id => ({
      id,
      label: group === 'subcategory' ? subcategoryLabels[id] ?? 'Подкатегория'
        : exerciseValueLabel(group, id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

/** Faceted graph: candidates for group G must satisfy every OTHER chosen group. */
export function facetedFilterOptions(
  group: FilterGroup,
  exercises: readonly CatalogueExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  subcategoryLabels: Readonly<Record<string, string>>,
  filters: SelectedFilters,
  query = '',
  categoryContext: string | null = null,
): FilterOption[] {
  const others = { ...filters, [group]: undefined };
  const candidates = filterPublicExercises(exercises, taxonomy, others, query, categoryContext);
  const populated = filterOptions(group, candidates, taxonomy, subcategoryLabels);
  if (group !== 'category') return populated;
  const available = new Set(candidates.map(row => row.category));
  return populated.filter(option => available.has(option.id));
}

/** The editor is deliberately UNFACETED: all known choices, including unused nodes. */
export function editorFieldOptions(
  group: 'category' | 'equipment' | 'movement_type' | 'muscle',
  exercises: readonly CatalogueExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  current: readonly string[] = [],
): FilterOption[] {
  if (group === 'category') return filterOptions('category', exercises, taxonomy, {});
  if (group === 'muscle') {
    const used = new Set([...taxonomy.map(node => node.id), ...current]);
    return [...used].map(id => ({ id, label: exerciseMuscleLabel(id, taxonomy) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }
  const ids = new Set([
    ...exercises.map(row => row[group]).filter(Boolean),
    ...Object.keys(group === 'equipment' ? EQUIPMENT_LABELS : MOVEMENT_LABELS),
    ...current,
  ].filter(Boolean));
  // Duplicate source aliases may share one Russian label. Prefer a currently
  // selected legacy ID so the editor keeps displaying the exact stored value.
  const seen = new Set<string>();
  return [...ids].sort((a, b) => a.localeCompare(b))
    .map(id => ({ id, label: exerciseValueLabel(group, id) }))
    .filter(option => {
      if (seen.has(option.label)) return false;
      seen.add(option.label);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
