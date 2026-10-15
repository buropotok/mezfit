import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from '../cloud/database';
import { isPublicExerciseRow, type PublicExercise } from './publicExerciseTypes';
import {
  coachFavouriteId, coachOverrideId, isCoachExerciseChanges, isCoachExerciseDefinition,
  type CoachExerciseChanges, type CoachExerciseDefinitionRow, type CoachExercisePersonalSnapshot,
} from './coachExerciseTypes';

/** All private records stay in the authenticated user's built-in Dexie Cloud realm. */
export class CoachExerciseCatalogueRepository {
  constructor(private readonly db: MezfitCloudDatabase, private readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_COACH_USER');
  }

  observe(
    onChange: (snapshot: CoachExercisePersonalSnapshot) => void,
    onError: (error: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(async () => {
      const [overrides, definitions, favourites] = await Promise.all([
        this.db.coachExerciseOverrides.where('realmId').equals(this.actorUserId).toArray(),
        this.db.coachExerciseDefinitions.where('realmId').equals(this.actorUserId).toArray(),
        this.db.coachExerciseFavourites.where('realmId').equals(this.actorUserId).toArray(),
      ]);
      return { overrides, definitions, favourites };
    }).subscribe({ next: onChange, error: onError });
  }

  async setFavourite(exerciseId: string, favourite: boolean): Promise<void> {
    const id = coachFavouriteId(this.actorUserId, exerciseId);
    // The reference must belong to the public catalogue or to this coach.
    if (/^\d{4}$/.test(exerciseId)) {
      if (!isPublicExerciseRow(await this.db.publicExerciseDefinitions.get(exerciseId))) {
        throw new Error('EXERCISE_NOT_FOUND');
      }
    } else {
      const row = await this.db.coachExerciseDefinitions.get(exerciseId);
      if (!isCoachExerciseDefinition(row, this.actorUserId) || row.archivedAt !== null) {
        throw new Error('EXERCISE_NOT_FOUND');
      }
    }
    if (favourite) {
      await this.db.coachExerciseFavourites.put({
        id, realmId: this.actorUserId, owner: this.actorUserId,
        exerciseId, createdAt: new Date().toISOString(),
      });
    } else {
      await this.db.coachExerciseFavourites.delete(id);
    }
  }

  async saveOverride(sourceExerciseId: string, changes: CoachExerciseChanges): Promise<void> {
    const id = coachOverrideId(this.actorUserId, sourceExerciseId);
    if (!isCoachExerciseChanges(changes)) throw new Error('INVALID_EXERCISE_OVERRIDE');
    if (!isPublicExerciseRow(await this.db.publicExerciseDefinitions.get(sourceExerciseId))) {
      throw new Error('EXERCISE_NOT_FOUND');
    }
    if (Object.keys(changes).length === 0) {
      await this.db.coachExerciseOverrides.delete(id);
      return;
    }
    await this.db.coachExerciseOverrides.put({
      id, realmId: this.actorUserId, owner: this.actorUserId,
      sourceExerciseId, changes, updatedAt: new Date().toISOString(),
    });
  }

  async createExercise(data: Omit<PublicExercise, 'id'>): Promise<string> {
    const id = `custom:${crypto.randomUUID()}`;
    const row: CoachExerciseDefinitionRow = {
      ...data,
      id, realmId: this.actorUserId, owner: this.actorUserId,
      sourceSha256: 'coach-custom', updatedAt: new Date().toISOString(), archivedAt: null,
    };
    if (!isCoachExerciseDefinition(row, this.actorUserId)) throw new Error('INVALID_CUSTOM_EXERCISE');
    await this.db.coachExerciseDefinitions.add(row);
    return id;
  }

  async updateExercise(id: string, changes: CoachExerciseChanges): Promise<void> {
    const previous = await this.db.coachExerciseDefinitions.get(id);
    if (!isCoachExerciseDefinition(previous, this.actorUserId) || previous.archivedAt !== null) {
      throw new Error('EXERCISE_NOT_FOUND');
    }
    if (!isCoachExerciseChanges(changes) || Object.keys(changes).length === 0) {
      throw new Error('INVALID_CUSTOM_EXERCISE');
    }
    const updated = { ...previous, ...changes, updatedAt: new Date().toISOString() };
    if (!isCoachExerciseDefinition(updated, this.actorUserId)) {
      throw new Error('INVALID_CUSTOM_EXERCISE');
    }
    await this.db.coachExerciseDefinitions.put(updated);
  }

  async archiveExercise(id: string): Promise<void> {
    const row = await this.db.coachExerciseDefinitions.get(id);
    if (!isCoachExerciseDefinition(row, this.actorUserId)) throw new Error('EXERCISE_NOT_FOUND');
    await this.db.coachExerciseDefinitions.update(id, { archivedAt: new Date().toISOString() });
  }
}
