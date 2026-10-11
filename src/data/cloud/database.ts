import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import cloudConfig from '../../../dexie-cloud.json';
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

// Dexie Cloud augments Dexie with strongly typed realms and members tables.
// Do not redeclare them here: synced members use accepted?: Date (not boolean),
// and privileged REST membership inputs are a separate contract.

export const CLOUD_DATABASE_STORES_V1 = {
  trainingPlans: '@id, realmId, coachUserId, clientUserId, [realmId+position]',
  workoutSessions: '@id, realmId, clientUserId, trainingPlanId, status, startedAt',
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
