import type { PublicExercise } from './exercise-types';

/** Validate a self-contained definition's payload, never its cloud state or owner. */
export function isExerciseDefinition(value: unknown): value is PublicExercise {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const muscles = row.muscles as Record<string, unknown> | undefined;
  const instructionSteps = row.instruction_steps as Record<string, unknown> | undefined;
  const instructions = row.instructions as Record<string, unknown> | undefined;
  return typeof row.id === 'string' && Boolean(row.id)
    && typeof row.name === 'string' && typeof row.name_ru === 'string'
    && typeof row.name_en === 'string' && typeof row.category === 'string'
    && typeof row.subcategory === 'string' && typeof row.subcategory_ru === 'string'
    && typeof row.movement_type === 'string'
    // Planning preserves result-tracking metadata without interpreting it.
    && typeof row.equipment === 'string' && typeof row.attribution === 'string'
    && typeof row.image === 'string' && typeof row.gif_url === 'string'
    && typeof row.media_id === 'string' && typeof row.created_at === 'string'
    && typeof row.body_part === 'string' && typeof row.target === 'string'
    && typeof row.muscle_group === 'string' && Array.isArray(row.secondary_muscles)
    && row.secondary_muscles.every((item: unknown) => typeof item === 'string')
    && typeof muscles === 'object' && muscles !== null
    && ['primary', 'secondary', 'stabilizers', 'emphasis'].every((field) => Array.isArray(muscles[field])
      && (muscles[field] as unknown[]).every((item) => typeof item === 'string'))
    && Array.isArray(row.mobility_targets)
    && row.mobility_targets.every((item: unknown) => typeof item === 'string')
    && typeof instructions === 'object' && instructions !== null && typeof instructions.ru === 'string'
    && typeof instructions.en === 'string'
    && typeof instructionSteps === 'object' && instructionSteps !== null && Array.isArray(instructionSteps.ru)
    && Array.isArray(instructionSteps.en)
    && instructionSteps.ru.every((item: unknown) => typeof item === 'string')
    && instructionSteps.en.every((item: unknown) => typeof item === 'string')
    && typeof row.anatomy_evidence === 'object' && row.anatomy_evidence !== null
    && typeof (row.anatomy_evidence as Record<string, unknown>).classification_family === 'string'
    && typeof (row.anatomy_evidence as Record<string, unknown>).basis === 'string'
    && typeof (row.anatomy_evidence as Record<string, unknown>).external_individual_match === 'boolean';
}
