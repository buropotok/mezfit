import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import cloudConfig from '../../../dexie-cloud.json';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';
import { getDexieCloudTokens } from '../../api';

/**
 * Cloud storage stays separate from legacy D1-hydrated IndexedDB until its
 * repositories have replaced the corresponding D1 domain endpoints.
 */
export const CLOUD_DATABASE_VERSION = 1;

export interface CloudSharedRow {
  id: string;
  realmId: string;
  // Explicit null prevents the creator's default ownership from bypassing
  // role-limited permissions in a shared coach-client realm.
  owner: null;
}

export interface CloudTrainingPlanRow extends CloudSharedRow {
  coachUserId: string;
  clientUserId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudWorkoutSessionRow extends CloudSharedRow {
  coachUserId: string;
  clientUserId: string;
  trainingPlanId: string | null;
  status: 'draft' | 'active' | 'completed';
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * An immutable PLAN snapshot captured by the privileged Workout Start operation.
 * A session set ID is globally unique and is also the key of its FACT counterpart.
 * Neither coach nor client can change these fields through ordinary sync.
 */
export interface CloudSessionSetRow extends CloudSharedRow {
  workoutSessionId: string;
  // Stable parent from the immutable session exercise snapshot (added in the workout slice).
  sessionExerciseId: string;
  sourceProgramSetId: string | null;
  position: number;
  plannedReps: number | null;
  plannedWeightKg: number | null;
  plannedDurationSeconds: number | null;
  plannedDistanceMeters: number | null;
}

/**
 * Editable measurements only. The privileged Worker materializes the record
 * together with the snapshot (same id / realmId / workoutSessionId).
 * Both roles can update a strict set of FACT fields, but cannot add/delete
 * records or change their identity, ownership, or workout association.
 */
export interface CloudSessionSetFactRow extends CloudSharedRow {
  workoutSessionId: string;
  actualReps: number | null;
  actualWeightKg: number | null;
  actualDurationSeconds: number | null;
  actualDistanceMeters: number | null;
  setLabel: SetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
  setStatus: 'pending' | 'completed' | 'skipped';
}

// Dexie Cloud augments Dexie with strongly typed realms and members tables.
// Do not redeclare them here: synced members use accepted?: Date (not boolean),
// and privileged REST membership inputs are a separate contract.

export const CLOUD_DATABASE_STORES_V1 = {
  trainingPlans: '@id, realmId, coachUserId, clientUserId, [realmId+position]',
  workoutSessions: '@id, realmId, clientUserId, trainingPlanId, status, startedAt',
  sessionSets: '@id, realmId, workoutSessionId, sessionExerciseId, [sessionExerciseId+position]',
  sessionSetFacts: '@id, realmId, workoutSessionId',
  realms: '@realmId',
  members: '@id, realmId, userId',
  roles: '[realmId+name]',
} as const;

export function cloudDatabaseName(telegramUserId: string): string {
  if (!/^[1-9]\d*$/.test(telegramUserId)) {
    throw new Error('INVALID_LOCAL_DATABASE_USER_ID');
  }
  return `mezfit-cloud:${telegramUserId}`;
}

export class MezfitCloudDatabase extends Dexie {
  trainingPlans!: Table<CloudTrainingPlanRow, string>;
  workoutSessions!: Table<CloudWorkoutSessionRow, string>;
  sessionSets!: Table<CloudSessionSetRow, string>;
  sessionSetFacts!: Table<CloudSessionSetFactRow, string>;

  constructor(telegramUserId: string, initData: string) {
    super(cloudDatabaseName(telegramUserId), { addons: [dexieCloud] });
    this.version(CLOUD_DATABASE_VERSION).stores(CLOUD_DATABASE_STORES_V1);
    this.cloud.configure({
      databaseUrl: cloudConfig.dbUrl,
      requireAuth: true,
      // Disable the email OTP UI: the Worker verifies Telegram initData.
      fetchTokens: (params) => getDexieCloudTokens(initData, params),
    });
  }
}

/** No singleton: the app lifecycle must own and close the instance on logout/account switch. */
export function createCloudDatabase(telegramUserId: string, initData: string): MezfitCloudDatabase {
  if (!initData) throw new Error('TELEGRAM_AUTH_REQUIRED');
  return new MezfitCloudDatabase(telegramUserId, initData);
}
