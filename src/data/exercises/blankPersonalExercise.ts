import type { PublicExercise } from './publicExerciseTypes';

/** In-memory exercise draft. It never creates a record until explicit Save. */
export function blankPersonalExercise(category: string | null): Omit<PublicExercise, 'id'> {
  return {
    name: '', name_ru: '', name_en: '', category: category ?? '',
    subcategory: '', subcategory_ru: '', movement_type: '',
    muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
    mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
    secondary_muscles: [], media_id: '', image: '', gif_url: '', attribution: '',
    created_at: new Date().toISOString(),
    instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
    source_consistency_issue: null,
    anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  };
}
