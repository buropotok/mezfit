import {
  archiveCoachExercise,
  createCoachExercise,
  getClientExerciseHistory,
  getCoachExercises,
  getWorkoutExerciseOptions,
  setCoachExerciseFavourite,
  updateCoachExercise,
  type ExerciseCategoryCode,
  type ExerciseDefinition,
  type ExerciseDefinitionInput,
} from '../../api';
import {
  createLocalDatabase,
  type LocalExerciseDefinitionRow,
  type LocalExerciseMembershipRow,
  type MezfitLocalDatabase,
} from '../local';
import { telegramUserIdFromInitData } from '../local/account';

export const EXERCISE_CATEGORY_CODES = [
  'chest',
  'arms',
  'back',
  'legs',
  'shoulders',
  'core',
  'full_body',
  'cardio',
  'other',
] as const satisfies readonly ExerciseCategoryCode[];

export type ExerciseDataset =
  | { kind: 'coach-catalog' }
  | { kind: 'workout' }
  | { kind: 'client-history'; clientUserId: number };

function datasetKey(dataset: ExerciseDataset): string {
  if (dataset.kind === 'client-history') return `client-history:${dataset.clientUserId}`;
  return dataset.kind;
}

function definitionRow(exercise: ExerciseDefinition, now: string): LocalExerciseDefinitionRow {
  return {
    id: String(exercise.id),
    serverId: exercise.id,
    scope: exercise.scope,
    ownerCoachUserId: null,
    ownerClientUserId: null,
    name: exercise.name,
    nameEn: exercise.name_en ?? null,
    description: exercise.description,
    trackingType: exercise.tracking_type,
    primaryMuscle: null,
    equipment: null,
    categoryCode: exercise.category_code,
    equipmentCode: exercise.equipment_code,
    referenceSource: exercise.reference_source,
    referenceKey: exercise.reference_key,
    referenceMediaUrl: exercise.reference_media_url,
    referenceOrder: null,
    sourceMetadataJson: null,
    isArchived: exercise.is_archived ?? false,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function membershipRow(
  contextKey: string,
  exercise: ExerciseDefinition,
): LocalExerciseMembershipRow {
  const exerciseDefinitionId = String(exercise.id);
  return {
    id: `${contextKey}:${exerciseDefinitionId}`,
    contextKey,
    exerciseDefinitionId,
    name: exercise.name,
    description: exercise.description,
    trackingType: exercise.tracking_type,
    categoryCode: exercise.category_code,
    equipmentCode: exercise.equipment_code,
    isFavourite: exercise.is_favourite,
    canEdit: exercise.can_edit,
  };
}

function exerciseView(
  definition: LocalExerciseDefinitionRow,
  membership: LocalExerciseMembershipRow,
): ExerciseDefinition {
  if (definition.serverId === undefined) {
    throw new Error('LOCAL_EXERCISE_SERVER_ID_MISSING');
  }
  return {
    id: definition.serverId,
    scope: definition.scope,
    name: membership.name,
    name_en: definition.nameEn,
    description: membership.description,
    tracking_type: membership.trackingType,
    category_code: membership.categoryCode,
    equipment_code: membership.equipmentCode,
    reference_source: definition.referenceSource,
    reference_key: definition.referenceKey,
    reference_media_url: definition.referenceMediaUrl,
    is_archived: definition.isArchived,
    is_favourite: membership.isFavourite,
    can_edit: membership.canEdit,
  };
}

async function replaceDataset(
  db: MezfitLocalDatabase,
  contextKey: string,
  exercises: ExerciseDefinition[],
): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(
    'rw',
    db.exerciseDefinitions,
    db.exerciseMemberships,
    async () => {
      await db.exerciseMemberships.where('contextKey').equals(contextKey).delete();
      if (exercises.length === 0) return;
      await db.exerciseDefinitions.bulkPut(exercises.map((exercise) => definitionRow(exercise, now)));
      await db.exerciseMemberships.bulkPut(
        exercises.map((exercise) => membershipRow(contextKey, exercise)),
      );
    },
  );
}

async function upsertCoachExercise(
  db: MezfitLocalDatabase,
  exercise: ExerciseDefinition,
): Promise<void> {
  const now = new Date().toISOString();
  const contextKey = 'coach-catalog';
  await db.transaction('rw', db.exerciseDefinitions, db.exerciseMemberships, async () => {
    await db.exerciseDefinitions.put(definitionRow(exercise, now));
    await db.exerciseMemberships.put(membershipRow(contextKey, exercise));
  });
}

export class ExerciseRepository {
  private readonly db: MezfitLocalDatabase;

  constructor(private readonly initData: string) {
    this.db = createLocalDatabase(telegramUserIdFromInitData(initData));
  }

  async read(dataset: ExerciseDataset): Promise<ExerciseDefinition[]> {
    const contextKey = datasetKey(dataset);
    const memberships = await this.db.exerciseMemberships
      .where('contextKey')
      .equals(contextKey)
      .toArray();
    if (memberships.length === 0) return [];

    const definitions = await this.db.exerciseDefinitions.bulkGet(
      memberships.map((membership) => membership.exerciseDefinitionId),
    );
    const result: ExerciseDefinition[] = [];
    for (let index = 0; index < memberships.length; index += 1) {
      const definition = definitions[index];
      if (definition) result.push(exerciseView(definition, memberships[index]));
    }
    return result.sort((left, right) => (
      left.name.localeCompare(right.name, 'ru-RU', { sensitivity: 'base' })
    ));
  }

  async refresh(dataset: ExerciseDataset): Promise<ExerciseDefinition[]> {
    let exercises: ExerciseDefinition[];
    if (dataset.kind === 'coach-catalog') {
      ({ exercises } = await getCoachExercises(this.initData, { sort: 'alphabetical' }));
    } else if (dataset.kind === 'client-history') {
      ({ exercises } = await getClientExerciseHistory(this.initData, dataset.clientUserId));
    } else {
      ({ exercises } = await getWorkoutExerciseOptions(this.initData));
    }

    await replaceDataset(this.db, datasetKey(dataset), exercises);
    return this.read(dataset);
  }

  async create(input: ExerciseDefinitionInput): Promise<ExerciseDefinition> {
    const { exercise } = await createCoachExercise(this.initData, input);
    await upsertCoachExercise(this.db, exercise);
    return exercise;
  }

  async update(exerciseId: number, input: ExerciseDefinitionInput): Promise<ExerciseDefinition> {
    const { exercise } = await updateCoachExercise(this.initData, exerciseId, input);
    await upsertCoachExercise(this.db, exercise);
    return exercise;
  }

  async setFavourite(exercise: ExerciseDefinition, favourite: boolean): Promise<void> {
    await setCoachExerciseFavourite(this.initData, exercise.id, favourite);
    const contextKey = 'coach-catalog';
    const membershipId = `${contextKey}:${exercise.id}`;
    const membership = await this.db.exerciseMemberships.get(membershipId);
    if (membership) {
      await this.db.exerciseMemberships.put({ ...membership, isFavourite: favourite });
    }
  }

  async archive(exerciseId: number): Promise<void> {
    await archiveCoachExercise(this.initData, exerciseId);
    const exerciseDefinitionId = String(exerciseId);
    await this.db.transaction(
      'rw',
      this.db.exerciseDefinitions,
      this.db.exerciseMemberships,
      async () => {
        const memberships = await this.db.exerciseMemberships
          .where('exerciseDefinitionId')
          .equals(exerciseDefinitionId)
          .toArray();
        const activeMembershipIds = memberships
          .filter((membership) => !membership.contextKey.startsWith('client-history:'))
          .map((membership) => membership.id);
        if (activeMembershipIds.length > 0) {
          await this.db.exerciseMemberships.bulkDelete(activeMembershipIds);
        }
        await this.db.exerciseDefinitions.update(exerciseDefinitionId, {
          isArchived: true,
          updatedAt: new Date().toISOString(),
        });
      },
    );
  }
}

export function createExerciseRepository(initData: string): ExerciseRepository {
  return new ExerciseRepository(initData);
}
