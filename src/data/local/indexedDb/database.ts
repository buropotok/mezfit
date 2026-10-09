import Dexie, { type Table } from 'dexie';
import type {
  LocalCoachClientRow,
  LocalExerciseDefinitionOverrideRow,
  LocalExerciseDefinitionRow,
  LocalExerciseFavouriteRow,
  LocalProgramDayRow,
  LocalProgramExerciseRow,
  LocalProgramPhaseRow,
  LocalProgramSetRow,
  LocalSessionExerciseRow,
  LocalSessionSetRow,
  LocalSyncRemoteStateRow,
  LocalSyncScopeRow,
  LocalTrainingPlanRow,
  LocalUserRow,
  LocalWorkoutOccurrenceRow,
  LocalWorkoutSessionRow,
} from '../schema';

const DATABASE_PREFIX = 'mezfit-local';

export const LOCAL_DATABASE_VERSION = 1;

export const LOCAL_DATABASE_STORES_V1 = {
  users: '&serverId,&telegramUserId',
  coachClients:
    '&relationshipId,coachUserId,clientUserId,&[coachUserId+clientUserId],&inviteId,status,[coachUserId+status],[clientUserId+status]',
  exerciseDefinitions:
    '&id,&serverId,scope,ownerCoachUserId,ownerClientUserId,[ownerCoachUserId+ownerClientUserId],name,categoryCode,trackingType,referenceOrder,&[referenceSource+referenceKey]',
  exerciseDefinitionOverrides:
    '&id,coachUserId,exerciseDefinitionId,&[coachUserId+exerciseDefinitionId]',
  exerciseFavourites: '&id,coachUserId,exerciseDefinitionId,&[coachUserId+exerciseDefinitionId]',
  trainingPlans:
    '&id,&serverId,userId,ownerCoachUserId,position,[userId+position],[ownerCoachUserId+userId+position]',
  programPhases:
    '&id,&serverId,trainingPlanId,&[trainingPlanId+position],status,[trainingPlanId+status+position]',
  // D1 uniqueness for day/exercise/set positions is partial (status = active).
  // These indexes intentionally stay non-unique; repositories must preserve the partial invariant transactionally.
  programDays:
    '&id,&serverId,programPhaseId,[programPhaseId+position],status,[programPhaseId+status+position]',
  programExercises:
    '&id,&serverId,programDayId,exerciseDefinitionId,[programDayId+position],status,[programDayId+status+position]',
  programSets:
    '&id,&serverId,programExerciseId,[programExerciseId+position],status,[programExerciseId+status+position]',
  workoutOccurrences:
    '&id,&serverId,coachUserId,clientUserId,calendarDateKey,[coachUserId+calendarDateKey],[clientUserId+calendarDateKey],[coachUserId+calendarDateKey+startMinute],[clientUserId+calendarDateKey+startMinute],programDayId,status',
  // D1 allows at most one open (draft/active) session per user; Start/initialize remain server-confirmed in MVP.
  workoutSessions:
    '&id,&serverId,userId,&occurrenceId,status,startedAt,[userId+status],[userId+startedAt]',
  sessionExercises:
    '&id,&serverId,workoutSessionId,exerciseDefinitionId,&[workoutSessionId+position],status,[workoutSessionId+status+position]',
  sessionSets:
    '&id,&serverId,sessionExerciseId,&[sessionExerciseId+position],status,[sessionExerciseId+status+position]',
  syncScopes: '&scopeKey,scopeType,status,nextRetryAt,[status+nextRetryAt]',
  syncRemoteState: '&id',
} as const;

export function localDatabaseName(telegramUserId: string): string {
  if (!/^[1-9]\d*$/.test(telegramUserId)) {
    throw new Error('INVALID_LOCAL_DATABASE_USER_ID');
  }
  return `${DATABASE_PREFIX}:${telegramUserId}`;
}

/**
 * D1 also has invariants that IndexedDB cannot express as direct partial/collated indexes:
 * - one active phase per training plan;
 * - unique active positions for program days/exercises/sets;
 * - one draft/active workout session per user;
 * - case-insensitive owner-scoped names for coach/client exercise definitions.
 *
 * Domain repositories must preserve these transactionally before marking a sync scope dirty.
 * The Worker remains the final validation boundary.
 */
export class MezfitLocalDatabase extends Dexie {
  users!: Table<LocalUserRow, number>;
  coachClients!: Table<LocalCoachClientRow, number>;
  exerciseDefinitions!: Table<LocalExerciseDefinitionRow, string>;
  exerciseDefinitionOverrides!: Table<LocalExerciseDefinitionOverrideRow, string>;
  exerciseFavourites!: Table<LocalExerciseFavouriteRow, string>;
  trainingPlans!: Table<LocalTrainingPlanRow, string>;
  programPhases!: Table<LocalProgramPhaseRow, string>;
  programDays!: Table<LocalProgramDayRow, string>;
  programExercises!: Table<LocalProgramExerciseRow, string>;
  programSets!: Table<LocalProgramSetRow, string>;
  workoutOccurrences!: Table<LocalWorkoutOccurrenceRow, string>;
  workoutSessions!: Table<LocalWorkoutSessionRow, string>;
  sessionExercises!: Table<LocalSessionExerciseRow, string>;
  sessionSets!: Table<LocalSessionSetRow, string>;
  syncScopes!: Table<LocalSyncScopeRow, string>;
  syncRemoteState!: Table<LocalSyncRemoteStateRow, 'default'>;

  constructor(telegramUserId: string) {
    super(localDatabaseName(telegramUserId));

    this.version(LOCAL_DATABASE_VERSION).stores(LOCAL_DATABASE_STORES_V1);
  }
}

export function createLocalDatabase(telegramUserId: string): MezfitLocalDatabase {
  return new MezfitLocalDatabase(telegramUserId);
}
