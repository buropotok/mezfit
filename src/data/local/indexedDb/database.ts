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
  users: '&serverId,telegramUserId',
  coachClients: '&relationshipId,coachUserId,clientUserId,[coachUserId+clientUserId],status',
  exerciseDefinitions:
    '&id,&serverId,scope,ownerCoachUserId,ownerClientUserId,[ownerCoachUserId+ownerClientUserId],name,categoryCode,trackingType,referenceOrder',
  exerciseDefinitionOverrides:
    '&id,coachUserId,exerciseDefinitionId,[coachUserId+exerciseDefinitionId]',
  exerciseFavourites: '&id,coachUserId,exerciseDefinitionId,[coachUserId+exerciseDefinitionId]',
  trainingPlans: '&id,&serverId,userId,ownerCoachUserId,[ownerCoachUserId+userId],position',
  programPhases: '&id,&serverId,trainingPlanId,[trainingPlanId+position],status',
  programDays: '&id,&serverId,programPhaseId,[programPhaseId+position],status',
  programExercises:
    '&id,&serverId,programDayId,exerciseDefinitionId,[programDayId+position],status',
  programSets: '&id,&serverId,programExerciseId,[programExerciseId+position],status',
  workoutOccurrences:
    '&id,&serverId,coachUserId,clientUserId,calendarDateKey,[coachUserId+calendarDateKey],[clientUserId+calendarDateKey],programDayId,status',
  workoutSessions: '&id,&serverId,userId,occurrenceId,status,startedAt,[userId+status]',
  sessionExercises:
    '&id,&serverId,workoutSessionId,exerciseDefinitionId,[workoutSessionId+position],status',
  sessionSets: '&id,&serverId,sessionExerciseId,[sessionExerciseId+position],status',
  syncScopes: '&scopeKey,scopeType,status,nextRetryAt,[status+nextRetryAt]',
  syncRemoteState: '&id',
} as const;

export function localDatabaseName(appUserId: number): string {
  if (!Number.isSafeInteger(appUserId) || appUserId <= 0) {
    throw new Error('INVALID_LOCAL_DATABASE_USER_ID');
  }
  return `${DATABASE_PREFIX}:${appUserId}`;
}

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

  constructor(appUserId: number) {
    super(localDatabaseName(appUserId));

    this.version(LOCAL_DATABASE_VERSION).stores(LOCAL_DATABASE_STORES_V1);
  }
}

export function createLocalDatabase(appUserId: number): MezfitLocalDatabase {
  return new MezfitLocalDatabase(appUserId);
}
