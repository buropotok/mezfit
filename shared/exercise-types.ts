/** Valid exercise result metrics; shared by the new catalogue and workout snapshots. */
export type ExerciseTrackingType = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';

/** Canonical public exercise definition, retaining stable IDs and media metadata. */
export interface PublicExercise {
  id: string;
  name: string;
  name_ru: string;
  name_en: string;
  category: string;
  subcategory: string;
  subcategory_ru: string;
  movement_type: string;
  /** Required for v2.1.0 public data; optional for existing v2.0.0 and personal records. */
  tracking_type?: ExerciseTrackingType;
  muscles: {
    primary: string[];
    secondary: string[];
    stabilizers: string[];
    emphasis: string[];
  };
  mobility_targets: string[];
  equipment: string;
  body_part: string;
  target: string;
  muscle_group: string;
  secondary_muscles: string[];
  media_id: string;
  image: string;
  gif_url: string;
  attribution: string;
  created_at: string;
  instructions: { en: string; ru: string };
  instruction_steps: { en: string[]; ru: string[] };
  source_consistency_issue: unknown | null;
  anatomy_evidence: {
    classification_family: string;
    basis: string;
    external_individual_match: boolean;
  };
}
