import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import cloudConfig from '../../../dexie-cloud.json';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';
import { getDexieCloudTokens } from '../../api';
import type { PublicExerciseRow, PublicExerciseCatalogueRow, PublicTaxonomyRow } from '../exercises/publicExerciseTypes';
import type { CoachExerciseOverrideRow, CoachExerciseDefinitionRow, CoachExerciseFavouriteRow } from '../exercises/coachExerciseTypes';
import type {
  CloudProgramPhaseRow, CloudProgramDayRow, CloudProgramExerciseRow, CloudProgramSetRow,
  CloudWorkoutOccurrenceRow, CloudSessionExerciseRow, CloudSessionFactExerciseRow, CloudSessionFactSetRow,
} from './workout-foundation-types';

/**
 * Cloud storage stays separate from legacy D1-hydrated IndexedDB until its
 * repositories have replaced the corresponding D1 domain endpoints.
 */
export const CLOUD_DATABASE_VERSION = 5;

export interface CloudSharedRow {
  id: string;
  realmId: string;
  // Explicit null prevents the creator's default ownership from bypassing
  // role-limited permissions in a shared coach-client realm.
  owner: null;
}

/** Materialized, read-only contact identity inside one authorized relationship realm. */
export interface CloudContactProfileRow extends CloudSharedRow {
  userId: string;
  name: string;
  avatarVersion: string | null;
  /** Verified Telegram initData auth_date in Unix milliseconds. */
  sourceAuthAt: number;
}

export interface CloudTrainingPlanRow extends CloudSharedRow {
  coachUserId: string;
  clientUserId: string;
  name: string;
  position: number;
  status: 'draft' | 'active' | 'finished';
  startedAt: string | null;
  finishedAt: string | null;
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

// Dexie Cloud augments Dexie with strongly typed realms and members tables.
// Do not redeclare them here: synced members can expose accepted Date or boolean,
// and privileged REST membership inputs are a separate contract.

export const CLOUD_DATABASE_STORES_V1 = {
  trainingPlans: '@id, realmId, coachUserId, clientUserId, [realmId+position]',
  workoutSessions: '@id, realmId, clientUserId, trainingPlanId, status, startedAt',
  sessionSets: '@id, realmId, workoutSessionId, sessionExerciseId, [sessionExerciseId+position]',
  // A deterministic key enforces 1:1 PLAN-to-FACT across devices. A distinct
  // `id` key (not `@id`) avoids cross-table prefix restrictions in Dexie Cloud.
  sessionSetFacts: 'id, realmId, sessionSetId, workoutSessionId',
  realms: '@realmId',
  members: '@id, realmId, userId',
  roles: '[realmId+name]',
} as const;

export const CLOUD_DATABASE_STORES_V2 = {
  ...CLOUD_DATABASE_STORES_V1,
  contactProfiles: 'id, realmId, userId',
} as const;

export const CLOUD_DATABASE_STORES_V3 = {
  ...CLOUD_DATABASE_STORES_V2,
  publicExerciseDefinitions: 'id, realmId, category, subcategory, movement_type, equipment',
  publicExerciseTaxonomy: 'id, realmId, kind, parent_id',
  publicExerciseCatalogues: 'id, realmId, sourceSha256',
} as const;

/**
 * Workout PLAN structure and FACT-only additions are distinct tables. None of
 * these tables receives write permission until the installed cloud ACL and
 * Worker lifecycle policy have been verified with two real identities.
 */
export const CLOUD_DATABASE_STORES_V4 = {
  ...CLOUD_DATABASE_STORES_V3,
  programPhases: '@id, realmId, trainingPlanId, [trainingPlanId+position]',
  programDays: '@id, realmId, programPhaseId, [programPhaseId+position]',
  programExercises: '@id, realmId, programDayId, [programDayId+position]',
  programSets: '@id, realmId, programExerciseId, [programExerciseId+position]',
  workoutOccurrences: '@id, realmId, clientUserId, programDayId, calendarDate, status, [realmId+calendarDate]',
  sessionExercises: '@id, realmId, workoutSessionId, [workoutSessionId+position]',
  sessionFactExercises: '@id, realmId, workoutSessionId, [workoutSessionId+position]',
  sessionFactSets: '@id, realmId, sessionFactExerciseId, [sessionFactExerciseId+position]',
} as const;

/** Private coach catalogue storage. Personal realm = authenticated Dexie Cloud user ID. */
export const CLOUD_DATABASE_STORES_V5 = {
  ...CLOUD_DATABASE_STORES_V4,
  coachExerciseOverrides: 'id, realmId, sourceExerciseId',
  coachExerciseDefinitions: 'id, realmId, category, subcategory, equipment',
  coachExerciseFavourites: 'id, realmId, exerciseId',
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
  trainingPlans!: Table<CloudTrainingPlanRow, string, Omit<CloudTrainingPlanRow, 'id'>>;
  programPhases!: Table<CloudProgramPhaseRow, string, Omit<CloudProgramPhaseRow, 'id'>>;
  programDays!: Table<CloudProgramDayRow, string, Omit<CloudProgramDayRow, 'id'>>;
  programExercises!: Table<CloudProgramExerciseRow, string, Omit<CloudProgramExerciseRow, 'id'>>;
  programSets!: Table<CloudProgramSetRow, string, Omit<CloudProgramSetRow, 'id'>>;
  workoutOccurrences!: Table<CloudWorkoutOccurrenceRow, string, Omit<CloudWorkoutOccurrenceRow, 'id'>>;
  sessionExercises!: Table<CloudSessionExerciseRow, string, Omit<CloudSessionExerciseRow, 'id'>>;
  sessionFactExercises!: Table<CloudSessionFactExerciseRow, string, Omit<CloudSessionFactExerciseRow, 'id'>>;
  sessionFactSets!: Table<CloudSessionFactSetRow, string, Omit<CloudSessionFactSetRow, 'id'>>;
  contactProfiles!: Table<CloudContactProfileRow, string>;
  workoutSessions!: Table<CloudWorkoutSessionRow, string>;
  sessionSets!: Table<CloudSessionSetRow, string>;
  sessionSetFacts!: Table<CloudSessionSetFactRow, string>;
  publicExerciseDefinitions!: Table<PublicExerciseRow, string>;
  publicExerciseTaxonomy!: Table<PublicTaxonomyRow, string>;
  publicExerciseCatalogues!: Table<PublicExerciseCatalogueRow, string>;
  coachExerciseOverrides!: Table<CoachExerciseOverrideRow, string>;
  coachExerciseDefinitions!: Table<CoachExerciseDefinitionRow, string>;
  coachExerciseFavourites!: Table<CoachExerciseFavouriteRow, string>;

  constructor(telegramUserId: string, initData: string) {
    super(cloudDatabaseName(telegramUserId), { addons: [dexieCloud] });
    this.version(1).stores(CLOUD_DATABASE_STORES_V1);
    this.version(2).stores(CLOUD_DATABASE_STORES_V2);
    this.version(3).stores(CLOUD_DATABASE_STORES_V3);
    this.version(4).stores(CLOUD_DATABASE_STORES_V4);
    this.version(CLOUD_DATABASE_VERSION).stores(CLOUD_DATABASE_STORES_V5);
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
