import { isPublicExerciseRow, type PublicExercise, type PublicExerciseRow } from './publicExerciseTypes';

/** Shared display model: public catalogue rows or coach-owned definitions. */
export type CatalogueExerciseRow = PublicExercise & {
  realmId: string;
  owner: string | null;
  sourceSha256: string;
  copiedFromExerciseId?: string;
  copiedFromScope?: 'public' | 'coach';
};

export type CoachExerciseChanges = Partial<Pick<PublicExercise,
  'name' | 'name_ru' | 'name_en' | 'category' | 'subcategory' | 'subcategory_ru'
  | 'movement_type' | 'muscles' | 'mobility_targets' | 'equipment' | 'body_part'
  | 'target' | 'muscle_group' | 'secondary_muscles' | 'instructions' | 'instruction_steps'
>>;

export interface CoachExerciseOverrideRow {
  id: string;
  realmId: string;
  owner: string;
  sourceExerciseId: string;
  changes: CoachExerciseChanges;
  updatedAt: string;
}

export type CoachExerciseDefinitionRow = CatalogueExerciseRow & {
  owner: string;
  sourceSha256: 'coach-custom';
  updatedAt: string;
  archivedAt: string | null;
};

export interface CoachExerciseFavouriteRow {
  id: string;
  realmId: string;
  owner: string;
  exerciseId: string;
  createdAt: string;
}

export interface CoachExercisePersonalSnapshot {
  overrides: CoachExerciseOverrideRow[];
  definitions: CoachExerciseDefinitionRow[];
  favourites: CoachExerciseFavouriteRow[];
}

export function coachOverrideId(actorUserId: string, publicExerciseId: string): string {
  if (!/^tg:[1-9]\d*$/.test(actorUserId) || !/^\d{4}$/.test(publicExerciseId)) {
    throw new Error('INVALID_COACH_EXERCISE_REFERENCE');
  }
  return `ovr:${actorUserId}:${publicExerciseId}`;
}

export function coachFavouriteId(actorUserId: string, exerciseId: string): string {
  if (!/^tg:[1-9]\d*$/.test(actorUserId)
    || (!/^\d{4}$/.test(exerciseId) && !/^custom:[0-9a-f-]{36}$/.test(exerciseId))) {
    throw new Error('INVALID_COACH_EXERCISE_REFERENCE');
  }
  return `fav:${actorUserId}:${exerciseId}`;
}

const editableFields: ReadonlySet<string> = new Set([
  'name', 'name_ru', 'name_en', 'category', 'subcategory', 'subcategory_ru',
  'movement_type', 'muscles', 'mobility_targets', 'equipment', 'body_part',
  'target', 'muscle_group', 'secondary_muscles', 'instructions', 'instruction_steps',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

export function isCoachExerciseChanges(value: unknown): value is CoachExerciseChanges {
  if (!isRecord(value) || Object.keys(value).some(key => !editableFields.has(key))) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'muscles') {
      if (!isRecord(item) || !['primary', 'secondary', 'stabilizers', 'emphasis'].every(k => strings(item[k]))) return false;
    } else if (key === 'mobility_targets' || key === 'secondary_muscles') {
      if (!strings(item)) return false;
    } else if (key === 'instructions') {
      if (!isRecord(item) || typeof item.ru !== 'string' || typeof item.en !== 'string') return false;
    } else if (key === 'instruction_steps') {
      if (!isRecord(item) || !strings(item.ru) || !strings(item.en)) return false;
    } else if (typeof item !== 'string') return false;
  }
  return true;
}

/** Reuse the complete public-field validator, replacing only trusted storage metadata for structural validation. */
export function isCoachExerciseDefinition(row: unknown, actorUserId: string): row is CoachExerciseDefinitionRow {
  if (!isRecord(row) || row.realmId !== actorUserId || row.owner !== actorUserId
    || row.sourceSha256 !== 'coach-custom' || typeof row.id !== 'string'
    || !/^custom:[0-9a-f-]{36}$/.test(row.id) || row.archivedAt !== null
    && typeof row.archivedAt !== 'string' || typeof row.updatedAt !== 'string') return false;
  return isPublicExerciseRow({
    ...row, id: '0000', realmId: 'rlm-public', owner: null, sourceSha256: '0'.repeat(64),
  });
}

export function resolveCoachExerciseCatalogue(
  publicExercises: readonly PublicExerciseRow[],
  personal: CoachExercisePersonalSnapshot,
  actorUserId: string,
): { exercises: CatalogueExerciseRow[]; favouriteIds: ReadonlySet<string> } {
  // Superseded business rule: global catalogue records are immutable in every view.
  // Legacy coachExerciseOverrides rows may exist locally but must never shadow the base.
  const exercises: CatalogueExerciseRow[] = publicExercises.map(row => ({ ...row }));
  const ids = new Set(exercises.map(row => row.id));
  for (const row of personal.definitions) {
    if (!isCoachExerciseDefinition(row, actorUserId) || row.archivedAt !== null || ids.has(row.id)) continue;
    exercises.push(row);
    ids.add(row.id);
  }
  const favouriteIds = new Set<string>();
  for (const row of personal.favourites) {
    if (row.realmId === actorUserId && row.owner === actorUserId && ids.has(row.exerciseId)
      && row.id === coachFavouriteId(actorUserId, row.exerciseId)) {
      favouriteIds.add(row.exerciseId);
    }
  }
  return { exercises, favouriteIds };
}

