import {
  ApiError,
  syncExerciseCoachSnapshot,
  type ExerciseCoachSyncSnapshot,
} from '../../api';
import type { MezfitLocalDatabase } from '../local';

const MAX_AUTOMATIC_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000] as const;

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrackingType(value: unknown): value is ExerciseCoachSyncSnapshot['definitions'][number]['trackingType'] {
  return value === 'weight_reps'
    || value === 'time'
    || value === 'time_distance'
    || value === 'time_reps'
    || value === 'time_weight';
}

function isCategoryCode(value: unknown): value is NonNullable<ExerciseCoachSyncSnapshot['definitions'][number]['categoryCode']> {
  return value === 'chest'
    || value === 'arms'
    || value === 'back'
    || value === 'legs'
    || value === 'shoulders'
    || value === 'core'
    || value === 'full_body'
    || value === 'cardio'
    || value === 'other';
}

function isEquipmentCode(value: unknown): value is NonNullable<ExerciseCoachSyncSnapshot['definitions'][number]['equipmentCode']> {
  return value === 'bodyweight'
    || value === 'barbell'
    || value === 'dumbbell_single'
    || value === 'dumbbell_pair'
    || value === 'cable'
    || value === 'machine'
    || value === 'other';
}

function parseInflightSnapshot(value: string): ExerciseCoachSyncSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (
    !Array.isArray(parsed.definitions)
    || !Array.isArray(parsed.overrides)
    || !Array.isArray(parsed.favourites)
  ) return null;

  const definitions: ExerciseCoachSyncSnapshot['definitions'] = [];
  for (const raw of parsed.definitions) {
    if (
      !isRecord(raw)
      || typeof raw.syncId !== 'string'
      || typeof raw.name !== 'string'
      || (raw.description !== null && typeof raw.description !== 'string')
      || !isTrackingType(raw.trackingType)
      || (raw.categoryCode !== null && !isCategoryCode(raw.categoryCode))
      || (raw.equipmentCode !== null && !isEquipmentCode(raw.equipmentCode))
    ) return null;
    definitions.push({
      syncId: raw.syncId,
      name: raw.name,
      description: raw.description,
      trackingType: raw.trackingType,
      categoryCode: raw.categoryCode,
      equipmentCode: raw.equipmentCode,
    });
  }

  const overrides: ExerciseCoachSyncSnapshot['overrides'] = [];
  for (const raw of parsed.overrides) {
    if (
      !isRecord(raw)
      || typeof raw.exerciseSyncId !== 'string'
      || typeof raw.name !== 'string'
      || (raw.description !== null && typeof raw.description !== 'string')
      || !isTrackingType(raw.trackingType)
      || !isCategoryCode(raw.categoryCode)
      || !isEquipmentCode(raw.equipmentCode)
    ) return null;
    overrides.push({
      exerciseSyncId: raw.exerciseSyncId,
      name: raw.name,
      description: raw.description,
      trackingType: raw.trackingType,
      categoryCode: raw.categoryCode,
      equipmentCode: raw.equipmentCode,
    });
  }

  if (parsed.favourites.some((item) => typeof item !== 'string')) return null;
  return {
    definitions,
    overrides,
    favourites: parsed.favourites.filter((item): item is string => typeof item === 'string'),
  };
}

async function buildSnapshot(db: MezfitLocalDatabase): Promise<ExerciseCoachSyncSnapshot> {
  const [definitions, overrides, favourites] = await Promise.all([
    db.exerciseDefinitions.where('scope').equals('coach').toArray(),
    db.exerciseDefinitionOverrides.toArray(),
    db.exerciseFavourites.toArray(),
  ]);

  return {
    definitions: definitions
      .filter((definition) => !definition.isArchived)
      .map((definition) => ({
        syncId: definition.id,
        name: definition.name,
        description: definition.description,
        trackingType: definition.trackingType,
        categoryCode: definition.categoryCode,
        equipmentCode: definition.equipmentCode,
      })),
    overrides: overrides.map((override) => ({
      exerciseSyncId: override.exerciseDefinitionId,
      name: override.name,
      description: override.description,
      trackingType: override.trackingType,
      categoryCode: override.categoryCode,
      equipmentCode: override.equipmentCode,
    })),
    favourites: favourites.map((favourite) => favourite.exerciseDefinitionId),
  };
}

type PreparedSync = {
  requestId: string;
  scopeKey: string;
  baseServerRevision: number;
  inflightRevision: number;
  snapshot: ExerciseCoachSyncSnapshot;
};

export class ExerciseSyncEngine {
  private running = false;
  private disposed = false;
  private retryTimer: number | null = null;
  private readonly onlineHandler = () => {
    void this.wake(true);
  };

  constructor(
    private readonly db: MezfitLocalDatabase,
    private readonly initData: string,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
    }
  }

  async wake(force = false): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      for (;;) {
        const prepared = await this.prepare(force);
        if (!prepared) return;

        try {
          const result = await syncExerciseCoachSnapshot(this.initData, {
            requestId: prepared.requestId,
            scopeKey: prepared.scopeKey,
            baseServerRevision: prepared.baseServerRevision,
            snapshot: prepared.snapshot,
          });
          if (!result.ok) {
            await this.markConflict(result.revision, 'SYNC_CONFLICT');
            return;
          }
          await this.markAcknowledged(prepared.inflightRevision, result.revision);
        } catch (error) {
          if (isRetryable(error)) {
            await this.markRetry(error);
          } else {
            await this.markConflict(
              null,
              error instanceof Error ? error.message : 'SYNC_REJECTED',
            );
          }
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async prepare(force: boolean): Promise<PreparedSync | null> {
    return this.db.transaction(
      'rw',
      this.db.syncScopes,
      this.db.exerciseDefinitions,
      this.db.exerciseDefinitionOverrides,
      this.db.exerciseFavourites,
      async () => {
        const scope = await this.db.syncScopes.where('scopeType').equals('exercise_coach').first();
        if (!scope || scope.status === 'clean' || scope.status === 'conflict') return null;

        const now = Date.now();
        if (
          !force
          && scope.status === 'retry_wait'
          && scope.nextRetryAt !== null
          && scope.nextRetryAt > now
        ) {
          this.scheduleRetry(scope.nextRetryAt - now);
          return null;
        }
        if (
          !force
          && scope.status === 'retry_wait'
          && scope.attemptCount >= MAX_AUTOMATIC_ATTEMPTS
          && scope.nextRetryAt === null
        ) return null;

        if (
          scope.serverRevision === null
          || !/^exercise-coach:\d+$/.test(scope.scopeKey)
        ) {
          await this.db.syncScopes.update(scope.scopeKey, {
            status: 'conflict',
            lastError: 'SYNC_BASE_REVISION_UNKNOWN',
            nextRetryAt: null,
            updatedAt: now,
          });
          return null;
        }

        if (
          scope.inflightRequestId
          && scope.inflightRevision !== null
          && scope.inflightSnapshotJson
        ) {
          const snapshot = parseInflightSnapshot(scope.inflightSnapshotJson);
          if (!snapshot) {
            await this.db.syncScopes.update(scope.scopeKey, {
              status: 'conflict',
              lastError: 'SYNC_INFLIGHT_SNAPSHOT_INVALID',
              nextRetryAt: null,
              updatedAt: now,
            });
            return null;
          }
          await this.db.syncScopes.update(scope.scopeKey, {
            status: 'syncing',
            nextRetryAt: null,
            updatedAt: now,
          });
          return {
            requestId: scope.inflightRequestId,
            scopeKey: scope.scopeKey,
            baseServerRevision: scope.serverRevision,
            inflightRevision: scope.inflightRevision,
            snapshot,
          };
        }

        const snapshot = await buildSnapshot(this.db);
        const requestId = createRequestId();
        const inflightRevision = scope.localRevision;
        await this.db.syncScopes.update(scope.scopeKey, {
          status: 'syncing',
          inflightRequestId: requestId,
          inflightRevision,
          inflightSnapshotJson: JSON.stringify(snapshot),
          nextRetryAt: null,
          updatedAt: now,
        });
        return {
          requestId,
          scopeKey: scope.scopeKey,
          baseServerRevision: scope.serverRevision,
          inflightRevision,
          snapshot,
        };
      },
    );
  }

  private async markAcknowledged(
    inflightRevision: number,
    serverRevision: number,
  ): Promise<void> {
    await this.db.transaction('rw', this.db.syncScopes, async () => {
      const scope = await this.db.syncScopes.where('scopeType').equals('exercise_coach').first();
      if (!scope) return;
      const clean = scope.localRevision === inflightRevision && !scope.remoteChanged;
      await this.db.syncScopes.update(scope.scopeKey, {
        serverRevision,
        status: clean ? 'clean' : 'dirty',
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        inflightRequestId: null,
        inflightRevision: null,
        inflightSnapshotJson: null,
        updatedAt: Date.now(),
      });
    });
  }

  private async markRetry(error: unknown): Promise<void> {
    const scope = await this.db.syncScopes.where('scopeType').equals('exercise_coach').first();
    if (!scope) return;
    const attemptCount = scope.attemptCount + 1;
    const exhausted = attemptCount >= MAX_AUTOMATIC_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    const nextRetryAt = exhausted ? null : Date.now() + delay;
    await this.db.syncScopes.update(scope.scopeKey, {
      status: 'retry_wait',
      attemptCount,
      nextRetryAt,
      lastError: error instanceof Error ? error.message : 'SYNC_NETWORK_ERROR',
      updatedAt: Date.now(),
    });
    if (!exhausted) this.scheduleRetry(delay);
  }

  private async markConflict(
    serverRevision: number | null,
    message: string,
  ): Promise<void> {
    const scope = await this.db.syncScopes.where('scopeType').equals('exercise_coach').first();
    if (!scope) return;
    await this.db.syncScopes.update(scope.scopeKey, {
      ...(serverRevision === null ? {} : { serverRevision }),
      status: 'conflict',
      nextRetryAt: null,
      lastError: message,
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
      updatedAt: Date.now(),
    });
  }

  private scheduleRetry(delay: number): void {
    if (this.disposed || typeof window === 'undefined') return;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.wake();
    }, Math.max(0, delay));
  }
}
