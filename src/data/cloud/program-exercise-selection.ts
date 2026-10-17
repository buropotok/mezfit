import { publicExerciseMediaUrl } from '../exercises/publicExerciseMedia';
import type { TrackingType } from '../../api';
import type { MezfitCloudDatabase } from './database';
import { isPublicCatalogueRow, isPublicExerciseRow } from '../exercises/publicExerciseTypes';
import { isCoachExerciseDefinition, type CatalogueExerciseRow } from '../exercises/coachExerciseTypes';
import type { CloudWorkoutExerciseSnapshot } from './workout-foundation-types';

export interface ProgramExerciseSelection { id: string; trackingType?: TrackingType }
export interface PreparedProgramExercise { id: string; name: string; trackingType: TrackingType | null }

/** Approved initial tracking defaults; unknown movement kinds require explicit input. */
export function programExerciseTracking(movementType: string): TrackingType | null {
  switch (movementType) {
    case 'resistance': case 'strength_or_skill': return 'weight_reps';
    case 'cardio': return 'time_distance';
    case 'mobility': return 'time';
    default: return null;
  }
}

export async function readProgramCatalogueExercise(db: MezfitCloudDatabase, actor: string,
  id: string): Promise<CatalogueExerciseRow> {
  if (/^\d{4}$/.test(id)) {
    const row = await db.publicExerciseDefinitions.get(id);
    const manifest = await db.publicExerciseCatalogues.get('mezfit:exercise-catalogue');
    if (isPublicExerciseRow(row) && isPublicCatalogueRow(manifest) && manifest.sourceSha256 === row.sourceSha256) return row;
  } else {
    const row = await db.coachExerciseDefinitions.get(id);
    if (isCoachExerciseDefinition(row, actor) && row.archivedAt === null) return row;
  }
  throw new Error('Упражнение недоступно. Обновите выбор.');
}

export function programExerciseSnapshot(row: CatalogueExerciseRow, actor: string,
  trackingType: TrackingType): CloudWorkoutExerciseSnapshot {
  const personal = row.realmId === actor;
  // Storage metadata is never copied into the immutable exercise definition.
  const { id, name, name_ru, name_en, category, subcategory, subcategory_ru, movement_type,
    muscles, mobility_targets, equipment, body_part, target, muscle_group, secondary_muscles,
    media_id, image, gif_url, attribution, created_at, instructions, instruction_steps,
    source_consistency_issue, anatomy_evidence } = row;
  return {
    exerciseDefinitionId: id, scope: personal ? 'coach' : 'public',
    name: name_ru || name, nameEn: name_en || null, trackingType, mediaUrl: publicExerciseMediaUrl(row),
    ...(personal ? { catalogueCoachUserId: actor, catalogueDefinition: {
      id, name, name_ru, name_en, category, subcategory, subcategory_ru, movement_type,
      muscles, mobility_targets, equipment, body_part, target, muscle_group, secondary_muscles,
      media_id, image, gif_url, attribution, created_at, instructions, instruction_steps,
      source_consistency_issue, anatomy_evidence,
    } } : {}),
  };
}
