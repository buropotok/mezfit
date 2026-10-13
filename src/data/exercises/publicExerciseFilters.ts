import type { PublicExerciseRow, PublicTaxonomyRow } from './publicExerciseTypes';

export const PUBLIC_EXERCISE_CATEGORIES = [
  ['chest', 'Грудь'], ['arms', 'Руки'], ['back', 'Спина'],
  ['legs', 'Ноги'], ['shoulders', 'Плечи'], ['core', 'Пресс и корпус'],
  ['full_body', 'Всё тело'], ['cardio', 'Кардио'], ['other', 'Другое'],
] as const;

export type FilterGroup = 'category' | 'subcategory' | 'equipment' | 'movement_type'
  | 'all_muscles' | 'primary' | 'secondary' | 'stabilizers' | 'emphasis'
  | 'mobility_targets' | 'zone';
export type SelectedFilters = Partial<Record<FilterGroup, string[]>>;
export type FilterOption = { id: string; label: string };

export const FILTER_GROUPS: ReadonlyArray<{ id: FilterGroup; label: string }> = [
  { id: 'category', label: 'Категория' },
  { id: 'subcategory', label: 'Подкатегория' },
  { id: 'equipment', label: 'Оборудование' },
  { id: 'movement_type', label: 'Тип движения' },
  { id: 'all_muscles', label: 'Мышцы и анатомические структуры' },
  { id: 'primary', label: 'Основные мышцы' },
  { id: 'secondary', label: 'Вспомогательные мышцы' },
  { id: 'stabilizers', label: 'Стабилизаторы' },
  { id: 'emphasis', label: 'Мышечный акцент' },
  { id: 'mobility_targets', label: 'Мышцы для растяжки' },
  { id: 'zone', label: 'Тренировочные зоны' },
];

export const EQUIPMENT_LABELS: Record<string, string> = {
  'body weight': 'Свой вес', barbell: 'Штанга', dumbbell: 'Гантели', cable: 'Блок / трос',
  machine: 'Тренажёр', kettlebell: 'Гиря', band: 'Резинка', 'resistance band': 'Резинка',
};
export const MOVEMENT_LABELS: Record<string, string> = {
  resistance: 'Силовые', mobility: 'Подвижность', cardio: 'Кардио',
  strength_or_skill: 'Сила и навык', skill: 'Навык',
};

export function normalizeExerciseSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim();
}

function muscleIds(row: PublicExerciseRow, group: FilterGroup, zones: ReadonlySet<string>): string[] {
  switch (group) {
    case 'primary': return row.muscles.primary;
    case 'secondary': return row.muscles.secondary;
    case 'stabilizers': return row.muscles.stabilizers;
    case 'emphasis': return row.muscles.emphasis;
    case 'mobility_targets': return row.mobility_targets;
    case 'all_muscles': return [
      ...row.muscles.primary, ...row.muscles.secondary, ...row.muscles.stabilizers,
    ];
    case 'zone': return [
      ...row.muscles.primary, ...row.muscles.secondary,
      ...row.muscles.stabilizers, ...row.muscles.emphasis,
      ...row.mobility_targets,
    ].filter((id) => zones.has(id));
    default: return [];
  }
}

/** Exact IDs: no implicit parent/child expansion. OR inside each group, AND across groups. */
export function filterPublicExercises(
  rows: readonly PublicExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  filters: SelectedFilters,
  query: string,
  categoryContext: string | null = null,
): PublicExerciseRow[] {
  const search = normalizeExerciseSearch(query);
  const zones = new Set(taxonomy.filter((row) => row.kind === 'zone').map((row) => row.id));
  const selected = FILTER_GROUPS.flatMap(({ id }) => filters[id]?.length ? [[id, new Set(filters[id])]] as const : []);
  return rows.filter((row) => {
    if (categoryContext && row.category !== categoryContext) return false;
    if (search && !normalizeExerciseSearch([
      row.name, row.name_ru, row.name_en, row.subcategory_ru,
    ].join(' ')).includes(search)) return false;
    return selected.every(([group, values]) => {
      if (group === 'category' || group === 'subcategory' || group === 'equipment' || group === 'movement_type') {
        return values.has(row[group]);
      }
      return muscleIds(row, group, zones).some((id) => values.has(id));
    });
  });
}

export function filterOptions(
  group: FilterGroup,
  exercises: readonly PublicExerciseRow[],
  taxonomy: readonly PublicTaxonomyRow[],
  subcategoryLabels: Readonly<Record<string, string>>,
): FilterOption[] {
  if (group === 'category') return PUBLIC_EXERCISE_CATEGORIES.map(([id, label]) => ({ id, label }));
  if (group === 'zone' || ['all_muscles', 'primary', 'secondary', 'stabilizers', 'emphasis', 'mobility_targets'].includes(group)) {
    const used = new Set(exercises.flatMap((row) => muscleIds(row, group, new Set(taxonomy.filter((node) => node.kind === 'zone').map((node) => node.id)))));
    return taxonomy.filter((node) => used.has(node.id) && (group !== 'zone' || node.kind === 'zone'))
      .map((node) => ({ id: node.id, label: node.subcategory_ru }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }
  // Narrow to scalar indexed fields; muscle groups are handled above.
  if (group !== 'subcategory' && group !== 'equipment' && group !== 'movement_type') return [];
  const labels: Record<string, string> = group === 'subcategory' ? subcategoryLabels
    : group === 'equipment' ? EQUIPMENT_LABELS : MOVEMENT_LABELS;
  return [...new Set(exercises.map((row) => row[group]))].sort((a, b) => a.localeCompare(b, 'ru'))
    .map((id) => ({ id, label: labels[id] ?? id }));
}
