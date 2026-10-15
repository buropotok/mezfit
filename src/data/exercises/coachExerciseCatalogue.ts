import { liveQuery } from 'dexie';
import { AssignedCoachExercisesRepository } from './assignedCoachExercises';
import type { MezfitCloudDatabase } from '../cloud/database';
import { isPublicExerciseRow, type PublicExercise } from './publicExerciseTypes';
import {
  coachFavouriteId, isCoachExerciseChanges, isCoachExerciseDefinition,
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

  /** Global base exercises are immutable. The only supported edit path is a private copy. */
  async duplicatePublicExercise(sourceExerciseId: string): Promise<string> {
    if (!/^\d{4}$/.test(sourceExerciseId)) throw new Error('EXERCISE_NOT_FOUND');
    const source = await this.db.publicExerciseDefinitions.get(sourceExerciseId);
    if (!isPublicExerciseRow(source)) throw new Error('EXERCISE_NOT_FOUND');
    const { id: _id, realmId: _realmId, owner: _owner, sourceSha256: _sha, ...data } = source;
    return this.createExercise({ ...structuredClone(data), created_at: new Date().toISOString() }, {
      copiedFromExerciseId: source.id, copiedFromScope: 'public',
    });
  }

  /** Authorize the copy from CURRENT assigned relationship snapshots, not caller-supplied data. */
  async duplicateAssignedCoachExercise(coachUserId: string, sourceExerciseId: string): Promise<string> {
    const assigned = new AssignedCoachExercisesRepository(this.db, this.actorUserId);
    const source = (await assigned.read(coachUserId)).find(row => row.id === sourceExerciseId);
    if (!source) throw new Error('EXERCISE_NOT_ASSIGNED');
    const { id: _id, realmId: _realmId, owner: _owner, sourceSha256: _sha, ...data } = source;
    return this.createExercise({ ...structuredClone(data), created_at: new Date().toISOString() }, {
      copiedFromExerciseId: source.id, copiedFromScope: 'coach',
    });
  }

  /** Blank personal item for FAB create. Does not require a trainer relationship. */
  async createBlankExercise(category: string | null = null, name: string): Promise<string> {
    const title = name.trim();
    if (!title || title.length > 120) throw new Error('INVALID_CUSTOM_EXERCISE_NAME');
    return this.createExercise({
      name: title, name_ru: title, name_en: '', category: category ?? 'other',
      subcategory: '', subcategory_ru: '', movement_type: 'resistance',
      muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
      mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
      secondary_muscles: [], media_id: '', image: '', gif_url: '', attribution: '',
      created_at: new Date().toISOString(),
      instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
      source_consistency_issue: null,
      anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
    });
  }

  async createExercise(data: Omit<PublicExercise, 'id'>, provenance?: {
    copiedFromExerciseId: string;
    copiedFromScope: 'public' | 'coach';
  }): Promise<string> {
    if (!data.name_ru.trim() || data.name_ru.trim().length > 120) {
      throw new Error('INVALID_CUSTOM_EXERCISE_NAME');
    }
    const id = `custom:${crypto.randomUUID()}`;
    const row: CoachExerciseDefinitionRow = {
      ...data,
      id, realmId: this.actorUserId, owner: this.actorUserId,
      sourceSha256: 'coach-custom', updatedAt: new Date().toISOString(), archivedAt: null,
      ...(provenance ?? {}),
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
    if (!updated.name_ru.trim() || updated.name_ru.trim().length > 120) throw new Error('INVALID_CUSTOM_EXERCISE_NAME');
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
