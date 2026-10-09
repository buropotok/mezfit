import {
  getClientExerciseHistory,
  getExerciseCoachSyncState,
  getWorkoutExerciseOptions,
  type ExerciseCategoryCode,
  type ExerciseCoachSyncState,
  type ExerciseDefinition,
  type ExerciseDefinitionInput,
} from '../../api';
import {
  createLocalDatabase,
  type LocalExerciseDefinitionRow,
  type LocalExerciseMembershipRow,
  type LocalSyncScopeRow,
  type MezfitLocalDatabase,
} from '../local';
import { telegramUserIdFromInitData } from '../local/account';
import { ExerciseSyncEngine } from '../sync/ExerciseSyncEngine';

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

const COACH_CONTEXT_KEY = 'coach-catalog';
const PENDING_COACH_SCOPE_KEY = 'exercise-coach:pending';

function datasetKey(dataset: ExerciseDataset): string {
  if (dataset.kind === 'client-history') return `client-history:${dataset.clientUserId}`;
  return dataset.kind;
}

function exerciseSyncId(exercise: ExerciseDefinition): string {
  return exercise.sync_id ?? String(exercise.id);
}

function localNumericId(syncId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < syncId.length; index += 1) {
    hash ^= syncId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return -((hash >>> 0) % 2_000_000_000 + 1);
}

function definitionRow(
  exercise: ExerciseDefinition,
  now: string,
  coachUserId: number | null = null,
): LocalExerciseDefinitionRow {
  const syncId = exerciseSyncId(exercise);
  return {
    id: syncId,
    serverId: exercise.id > 0 ? exercise.id : undefined,
    scope: exercise.scope,
    ownerCoachUserId: exercise.scope === 'coach' ? coachUserId : null,
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
  const exerciseDefinitionId = exerciseSyncId(exercise);
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
  return {
    id: definition.serverId ?? localNumericId(definition.id),
    sync_id: definition.id,
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

function parseCoachUserId(scopeKey: string): number | null {
  const match = /^exercise-coach:(\d+)$/.exec(scopeKey);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function createSyncId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function currentCoachScope(db: MezfitLocalDatabase): Promise<LocalSyncScopeRow | undefined> {
  return db.syncScopes.where('scopeType').equals('exercise_coach').first();
}

async function markCoachScopeDirty(db: MezfitLocalDatabase): Promise<void> {
  const scope = await currentCoachScope(db);
  const now = Date.now();
  if (!scope) {
    await db.syncScopes.put({
      scopeKey: PENDING_COACH_SCOPE_KEY,
      scopeType: 'exercise_coach',
      localRevision: 1,
      serverRevision: null,
      status: 'dirty',
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
      remoteChanged: false,
      updatedAt: now,
    });
    return;
  }

  await db.syncScopes.update(scope.scopeKey, {
    localRevision: scope.localRevision + 1,
    status: scope.status === 'conflict' ? 'conflict' : 'dirty',
    nextRetryAt: scope.status === 'conflict' ? scope.nextRetryAt : null,
    lastError: scope.status === 'conflict' ? scope.lastError : null,
    updatedAt: now,
  });
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

async function replaceCoachDataset(
  db: MezfitLocalDatabase,
  state: ExerciseCoachSyncState,
): Promise<void> {
  const now = new Date().toISOString();
  const coachUserId = parseCoachUserId(state.scopeKey);
  if (coachUserId === null) throw new Error('INVALID_EXERCISE_COACH_SCOPE');

  await db.transaction(
    'rw',
    db.exerciseDefinitions,
    db.exerciseMemberships,
    db.exerciseDefinitionOverrides,
    db.exerciseFavourites,
    db.syncScopes,
    async () => {
      const previousScope = await currentCoachScope(db);
      await db.exerciseMemberships.where('contextKey').equals(COACH_CONTEXT_KEY).delete();
      await db.exerciseDefinitionOverrides.clear();
      await db.exerciseFavourites.clear();

      const activeCoachSyncIds = new Set(
        state.exercises
          .filter((exercise) => exercise.scope === 'coach')
          .map(exerciseSyncId),
      );
      const existingCoachDefinitions = await db.exerciseDefinitions
        .where('scope')
        .equals('coach')
        .toArray();
      for (const definition of existingCoachDefinitions) {
        if (!definition.isArchived && !activeCoachSyncIds.has(definition.id)) {
          await db.exerciseDefinitions.put({
            ...definition,
            isArchived: true,
            updatedAt: now,
          });
        }
      }

      if (state.exercises.length > 0) {
        await db.exerciseDefinitions.bulkPut(
          state.exercises.map((exercise) => definitionRow(exercise, now, coachUserId)),
        );
        await db.exerciseMemberships.bulkPut(
          state.exercises.map((exercise) => membershipRow(COACH_CONTEXT_KEY, exercise)),
        );
      }

      if (state.overrides.length > 0) {
        await db.exerciseDefinitionOverrides.bulkPut(
          state.overrides.map((override) => ({
            id: `${coachUserId}:${override.exerciseSyncId}`,
            coachUserId,
            exerciseDefinitionId: override.exerciseSyncId,
            name: override.name,
            description: override.description,
            trackingType: override.trackingType,
            categoryCode: override.categoryCode,
            equipmentCode: override.equipmentCode,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      if (state.favourites.length > 0) {
        await db.exerciseFavourites.bulkPut(
          state.favourites.map((exerciseDefinitionId) => ({
            id: `${coachUserId}:${exerciseDefinitionId}`,
            coachUserId,
            exerciseDefinitionId,
            createdAt: now,
          })),
        );
      }

      if (previousScope && previousScope.scopeKey !== state.scopeKey) {
        await db.syncScopes.delete(previousScope.scopeKey);
      }
      await db.syncScopes.put({
        scopeKey: state.scopeKey,
        scopeType: 'exercise_coach',
        localRevision: previousScope?.localRevision ?? 0,
        serverRevision: state.revision,
        status: 'clean',
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        inflightRequestId: null,
        inflightRevision: null,
        inflightSnapshotJson: null,
        remoteChanged: false,
        updatedAt: Date.now(),
      });
    },
  );
}

async function assertCoachNameAvailable(
  db: MezfitLocalDatabase,
  name: string,
  excludingSyncId?: string,
): Promise<void> {
  const normalized = name.normalize('NFKC').toLocaleLowerCase('ru-RU');
  const definitions = await db.exerciseDefinitions.where('scope').equals('coach').toArray();
  const duplicate = definitions.some((definition) => (
    definition.id !== excludingSyncId
    && definition.name.normalize('NFKC').toLocaleLowerCase('ru-RU') === normalized
  ));
  if (duplicate) throw new Error('Упражнение с таким названием уже существует');
}

export class ExerciseRepository {
  private readonly db: MezfitLocalDatabase;
  private readonly syncEngine: ExerciseSyncEngine;

  constructor(private readonly initData: string) {
    this.db = createLocalDatabase(telegramUserIdFromInitData(initData));
    this.syncEngine = new ExerciseSyncEngine(this.db, initData);
  }

  dispose(): void {
    this.syncEngine.dispose();
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
    if (dataset.kind === 'coach-catalog') {
      const scope = await currentCoachScope(this.db);
      if (scope && scope.status !== 'clean') {
        if (scope.status !== 'conflict') void this.syncEngine.wake();
        return this.read(dataset);
      }

      const state = await getExerciseCoachSyncState(this.initData);
      await replaceCoachDataset(this.db, state);
      return this.read(dataset);
    }

    const { exercises } = dataset.kind === 'client-history'
      ? await getClientExerciseHistory(this.initData, dataset.clientUserId)
      : await getWorkoutExerciseOptions(this.initData);
    await replaceDataset(this.db, datasetKey(dataset), exercises);
    return this.read(dataset);
  }

  async create(input: ExerciseDefinitionInput): Promise<ExerciseDefinition> {
    const syncId = createSyncId();
    const now = new Date().toISOString();
    let created: ExerciseDefinition | null = null;

    await this.db.transaction(
      'rw',
      this.db.exerciseDefinitions,
      this.db.exerciseMemberships,
      this.db.syncScopes,
      async () => {
        await assertCoachNameAvailable(this.db, input.name);
        const scope = await currentCoachScope(this.db);
        const coachUserId = scope ? parseCoachUserId(scope.scopeKey) : null;
        const definition: LocalExerciseDefinitionRow = {
          id: syncId,
          scope: 'coach',
          ownerCoachUserId: coachUserId,
          ownerClientUserId: null,
          name: input.name.trim(),
          nameEn: null,
          description: input.description?.trim() || null,
          trackingType: input.trackingType,
          primaryMuscle: null,
          equipment: null,
          categoryCode: input.categoryCode,
          equipmentCode: input.equipmentCode,
          referenceSource: null,
          referenceKey: null,
          referenceMediaUrl: null,
          referenceOrder: null,
          sourceMetadataJson: null,
          isArchived: false,
          createdByUserId: coachUserId,
          createdAt: now,
          updatedAt: now,
        };
        const membership: LocalExerciseMembershipRow = {
          id: `${COACH_CONTEXT_KEY}:${syncId}`,
          contextKey: COACH_CONTEXT_KEY,
          exerciseDefinitionId: syncId,
          name: definition.name,
          description: definition.description,
          trackingType: definition.trackingType,
          categoryCode: definition.categoryCode,
          equipmentCode: definition.equipmentCode,
          isFavourite: false,
          canEdit: true,
        };
        await this.db.exerciseDefinitions.put(definition);
        await this.db.exerciseMemberships.put(membership);
        await markCoachScopeDirty(this.db);
        created = exerciseView(definition, membership);
      },
    );

    void this.syncEngine.wake();
    if (!created) throw new Error('LOCAL_EXERCISE_CREATE_FAILED');
    return created;
  }

  async update(
    exercise: ExerciseDefinition,
    input: ExerciseDefinitionInput,
  ): Promise<ExerciseDefinition> {
    const syncId = exerciseSyncId(exercise);
    let updated: ExerciseDefinition | null = null;

    await this.db.transaction(
      'rw',
      this.db.exerciseDefinitions,
      this.db.exerciseMemberships,
      this.db.exerciseDefinitionOverrides,
      this.db.syncScopes,
      async () => {
        const definition = await this.db.exerciseDefinitions.get(syncId);
        const membership = await this.db.exerciseMemberships.get(`${COACH_CONTEXT_KEY}:${syncId}`);
        if (!definition || !membership) throw new Error('Упражнение не найдено');

        const cleanName = input.name.trim();
        const cleanDescription = input.description?.trim() || null;
        if (definition.scope === 'coach') {
          await assertCoachNameAvailable(this.db, cleanName, syncId);
          const nextDefinition = {
            ...definition,
            name: cleanName,
            description: cleanDescription,
            trackingType: input.trackingType,
            categoryCode: input.categoryCode,
            equipmentCode: input.equipmentCode,
            updatedAt: new Date().toISOString(),
          };
          const nextMembership = {
            ...membership,
            name: cleanName,
            description: cleanDescription,
            trackingType: input.trackingType,
            categoryCode: input.categoryCode,
            equipmentCode: input.equipmentCode,
          };
          await this.db.exerciseDefinitions.put(nextDefinition);
          await this.db.exerciseMemberships.put(nextMembership);
          updated = exerciseView(nextDefinition, nextMembership);
        } else if (definition.scope === 'global') {
          const scope = await currentCoachScope(this.db);
          const coachUserId = scope ? parseCoachUserId(scope.scopeKey) : null;
          if (coachUserId === null) throw new Error('SYNC_BASE_REVISION_UNKNOWN');
          const timestamp = new Date().toISOString();
          await this.db.exerciseDefinitionOverrides.put({
            id: `${coachUserId}:${syncId}`,
            coachUserId,
            exerciseDefinitionId: syncId,
            name: cleanName,
            description: cleanDescription,
            trackingType: input.trackingType,
            categoryCode: input.categoryCode,
            equipmentCode: input.equipmentCode,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          const nextMembership = {
            ...membership,
            name: cleanName,
            description: cleanDescription,
            trackingType: input.trackingType,
            categoryCode: input.categoryCode,
            equipmentCode: input.equipmentCode,
          };
          await this.db.exerciseMemberships.put(nextMembership);
          updated = exerciseView(definition, nextMembership);
        } else {
          throw new Error('Упражнение доступно только для просмотра');
        }

        await markCoachScopeDirty(this.db);
      },
    );

    void this.syncEngine.wake();
    if (!updated) throw new Error('LOCAL_EXERCISE_UPDATE_FAILED');
    return updated;
  }

  async setFavourite(exercise: ExerciseDefinition, favourite: boolean): Promise<void> {
    const syncId = exerciseSyncId(exercise);
    await this.db.transaction(
      'rw',
      this.db.exerciseMemberships,
      this.db.exerciseFavourites,
      this.db.syncScopes,
      async () => {
        const membership = await this.db.exerciseMemberships.get(`${COACH_CONTEXT_KEY}:${syncId}`);
        if (!membership) throw new Error('Упражнение не найдено');
        const scope = await currentCoachScope(this.db);
        const coachUserId = scope ? parseCoachUserId(scope.scopeKey) : null;
        if (coachUserId === null) throw new Error('SYNC_BASE_REVISION_UNKNOWN');
        const favouriteId = `${coachUserId}:${syncId}`;
        if (favourite) {
          await this.db.exerciseFavourites.put({
            id: favouriteId,
            coachUserId,
            exerciseDefinitionId: syncId,
            createdAt: new Date().toISOString(),
          });
        } else {
          await this.db.exerciseFavourites.delete(favouriteId);
        }
        await this.db.exerciseMemberships.put({ ...membership, isFavourite: favourite });
        await markCoachScopeDirty(this.db);
      },
    );
    void this.syncEngine.wake();
  }

  async archive(exercise: ExerciseDefinition): Promise<void> {
    const syncId = exerciseSyncId(exercise);
    await this.db.transaction(
      'rw',
      this.db.exerciseDefinitions,
      this.db.exerciseMemberships,
      this.db.exerciseFavourites,
      this.db.syncScopes,
      async () => {
        const definition = await this.db.exerciseDefinitions.get(syncId);
        if (!definition || definition.scope !== 'coach') {
          throw new Error('Базовое упражнение нельзя удалить');
        }
        const memberships = await this.db.exerciseMemberships
          .where('exerciseDefinitionId')
          .equals(syncId)
          .toArray();
        const activeMembershipIds = memberships
          .filter((membership) => !membership.contextKey.startsWith('client-history:'))
          .map((membership) => membership.id);
        if (activeMembershipIds.length > 0) {
          await this.db.exerciseMemberships.bulkDelete(activeMembershipIds);
        }
        const favourites = await this.db.exerciseFavourites
          .where('exerciseDefinitionId')
          .equals(syncId)
          .toArray();
        if (favourites.length > 0) {
          await this.db.exerciseFavourites.bulkDelete(favourites.map((item) => item.id));
        }
        await this.db.exerciseDefinitions.put({
          ...definition,
          isArchived: true,
          updatedAt: new Date().toISOString(),
        });
        await markCoachScopeDirty(this.db);
      },
    );
    void this.syncEngine.wake();
  }
}

export function createExerciseRepository(initData: string): ExerciseRepository {
  return new ExerciseRepository(initData);
}
