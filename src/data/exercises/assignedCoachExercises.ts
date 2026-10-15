import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from '../cloud/database';
import { WorkoutFoundationRepository } from '../cloud/workout-foundation';
import {
  isAssignedCoachExerciseSnapshot,
  type CloudProgramOutline,
} from '../cloud/workout-foundation-types';
import type { CatalogueExerciseRow } from './coachExerciseTypes';

/** A copy of the definition that is already permitted inside this one relationship. */
export type AssignedCoachExerciseRow = CatalogueExerciseRow & {
  owner: null;
  sourceSha256: 'assigned-coach-snapshot';
};

export function projectAssignedCoachExercises(
  outlines: readonly CloudProgramOutline[],
  coachUserId: string,
): AssignedCoachExerciseRow[] {
  const byId = new Map<string, AssignedCoachExerciseRow>();
  for (const outline of outlines) {
    for (const { days } of outline.phases) {
      for (const { day, exercises } of days) {
        if (day.status !== 'active') continue;
        for (const { exercise } of exercises) {
          if (exercise.status !== 'active') continue;
          const snapshot = exercise.exercise;
          if (!isAssignedCoachExerciseSnapshot(snapshot, coachUserId)) continue;
          const row: AssignedCoachExerciseRow = {
            ...snapshot.catalogueDefinition,
            realmId: outline.realmId,
            owner: null,
            sourceSha256: 'assigned-coach-snapshot',
          };
          byId.set(row.id, row);
        }
      }
    }
  }
  return [...byId.values()];
}

/**
 * Client access comes only from plans tied to this client and the selected coach.
 * WorkoutFoundationRepository checks the canonical realm, BOTH accepted members,
 * ownerless shared records, and every parent-child realm link before projection.
 * No query ever touches the coach's private exercise definitions.
 */
export class AssignedCoachExercisesRepository {
  constructor(private readonly db: MezfitCloudDatabase, private readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_CLIENT_USER');
  }

  async read(coachUserId: string): Promise<AssignedCoachExerciseRow[]> {
    if (!/^tg:[1-9]\d*$/.test(coachUserId) || coachUserId === this.actorUserId) return [];
    const plans = (await this.db.trainingPlans.where('clientUserId').equals(this.actorUserId).toArray())
      .filter(plan => plan.clientUserId === this.actorUserId
        && plan.coachUserId === coachUserId && plan.owner === null);
    const foundation = new WorkoutFoundationRepository(this.db, this.actorUserId);
    const outlines = await Promise.all(plans.map(plan => foundation.getProgramOutline(plan.id)));
    return projectAssignedCoachExercises(
      outlines.filter((outline): outline is CloudProgramOutline => outline !== null),
      coachUserId,
    );
  }

  observe(coachUserId: string | null,
    onChange: (rows: AssignedCoachExerciseRow[]) => void,
    onError: (cause: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(() => coachUserId ? this.read(coachUserId) : Promise.resolve([]))
      .subscribe({ next: onChange, error: onError });
  }
}
