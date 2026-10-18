import type { PublicExercise } from './exercise-types';

/** Canonical exercise identity. Keep a self-contained snapshot for coach-private
 * exercises that a client may not be able to query outside this relationship. */
export interface CloudProgramExerciseSnapshot {
  exerciseDefinitionId: string;
  scope: 'public' | 'coach' | 'client';
  name: string;
  nameEn: string | null;
  /** Legacy program records may contain this metadata. Program authoring and
   * projection deliberately ignore it; newly added program exercises omit it. */
  trackingType?: unknown;
  mediaUrl: string | null;
  /** Immutable full definition captured when a coach assigns a private exercise. */
  catalogueDefinition?: PublicExercise;
  /** Original author; must match the selected, accepted relationship coach. */
  catalogueCoachUserId?: string;
}
