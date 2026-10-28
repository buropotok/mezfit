import type { MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';

/** Athlete execution on the shared local-first graph. No source PLAN authoring.
 * Client UI adopts this repository in the next slice; the current viewer stays read-only.
 * FACT handoff follows the sequential workflow, without an ownership lock.
 */
export class ClientWorkoutRepository extends AdHocWorkoutRepository {
  protected override get clientExecution(): boolean { return true; }
  constructor(db: MezfitCloudDatabase, actorUserId: string) {
    super(db, actorUserId);
  }
}
