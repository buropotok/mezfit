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
 * The related FACT has a deterministic, independent primary key derived from this ID.
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
 * together with the snapshot (matching sessionSetId / realmId / workoutSessionId).
 * Both roles can update a strict set of FACT fields, but cannot add/delete
 * records or change their identity, ownership, or workout association.
 */
export interface CloudSessionSetFactRow extends CloudSharedRow {
  sessionSetId: string;
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

/**
 * Persisted audit envelope. Rows are created by a privileged, authenticated
 * server path only, using identity and timestamps verified independently from
 * any client-supplied payload. Never accept these values from a synced FACT
 * row or treat a local edit as a confirmed audit record.
 *
 * confirmedAt is the trusted cloud-commit timestamp, not necessarily the
 * physical time of an edit made offline and synchronized later.
 *
 * The foundation does not yet implement an event recorder. Before enabling
 * cloud FACT writes, the runtime must prove a complete server-side mechanism
 * that captures all authorized edits, including edits synced after offline use.
 */
export interface CloudSessionSetFactAuditRow extends CloudSharedRow {
  sessionSetFactId: string;
  sessionSetId: string;
  workoutSessionId: string;
  actorUserId: string;
  confirmedAt: string;
  changedFields: Array<
    | 'actualReps'
    | 'actualWeightKg'
    | 'actualDurationSeconds'
    | 'actualDistanceMeters'
    | 'setLabel'
    | 'rpe'
    | 'comment'
    | 'bands'
    | 'setStatus'
  >;
}

// Dexie Cloud augments Dexie with strongly typed realms and members tables.
// Do not redeclare them here: synced members use accepted?: Date (not boolean),
// and privileged REST membership inputs are a separate contract.

export const CLOUD_DATABASE_STORES_V1 = {
  trainingPlans: '@id, realmId, coachUserId, clientUserId, [realmId+position]',
  workoutSessions: '@id, realmId, clientUserId, trainingPlanId, status, startedAt',
  sessionSets: '@id, realmId, workoutSessionId, sessionExerciseId, [sessionExerciseId+position]',
  // A deterministic key enforces 1:1 PLAN-to-FACT across devices. A distinct
  // `id` key (not `@id`) avoids cross-table prefix restrictions in Dexie Cloud.
  sessionSetFacts: 'id, realmId, sessionSetId, workoutSessionId',
  sessionSetFactAudits: '@id, realmId, sessionSetFactId, sessionSetId, workoutSessionId, confirmedAt',
  realms: '@realmId',
  members: '@id, realmId, userId',
  roles: '[realmId+name]',
} as const;

/**
 * Stable one-to-one FACT ID. `@id` in different Dexie Cloud tables cannot
 * reuse another table's prefix. An ordinary `id` key can safely be derived
 * from the globally unique session set ID and used for idempotent creation.
 */
export function sessionSetFactId(sessionSetId: string): string {
  if (!sessionSetId || !/^[A-Za-z0-9_-]+$/.test(sessionSetId)) {
    throw new Error('INVALID_CLOUD_SESSION_SET_ID');
  }
  return `fact:${sessionSetId}`;
}

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
  sessionSetFactAudits!: Table<CloudSessionSetFactAuditRow, string>;

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
