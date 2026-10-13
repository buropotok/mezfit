/** Canonical JSON 2.0.0, with its original four-character IDs and media metadata. */
export interface PublicExercise {
  id: string;
  name: string;
  name_ru: string;
  name_en: string;
  category: string;
  subcategory: string;
  subcategory_ru: string;
  movement_type: string;
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

export interface PublicTaxonomyNode {
  category_ru: string;
  subcategory_ru: string;
  anatomical_description_ru: string;
  kind: 'muscle' | 'group' | 'head' | 'part' | 'zone' | 'function';
  parent_id: string | null;
}

export type PublicExerciseRow = PublicExercise & {
  realmId: 'rlm-public';
  owner: null;
  sourceSha256: string;
};

export type PublicTaxonomyRow = PublicTaxonomyNode & {
  id: string;
  realmId: 'rlm-public';
  owner: null;
  sourceSha256: string;
};

export type PublicExerciseCatalogueRow = {
  id: 'mezfit:exercise-catalogue';
  realmId: 'rlm-public';
  owner: null;
  schemaVersion: '2.0.0';
  catalogue: 'mezfit.exercise_catalog.ru_anatomy';
  sourceSha256: string;
  exerciseCount: number;
  taxonomyCount: number;
  subcategoryLabelsRu: Record<string, string>;
  movementFamilyReferences: Record<string, string>;
  metadata: Record<string, unknown>;
  publishedAt: string;
};

/** Reject malformed cloud rows instead of treating a partial object as an exercise. */
export function isPublicExerciseRow(value: unknown): value is PublicExerciseRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const muscles = row.muscles as Record<string, unknown> | undefined;
  const instructionSteps = row.instruction_steps as Record<string, unknown> | undefined;
  const instructions = row.instructions as Record<string, unknown> | undefined;
  return typeof row.id === 'string' && /^\d{4}$/.test(row.id)
    && row.realmId === 'rlm-public' && row.owner === null
    && typeof row.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sourceSha256)
    && typeof row.name === 'string' && typeof row.name_ru === 'string'
    && typeof row.name_en === 'string' && typeof row.category === 'string'
    && typeof row.subcategory === 'string' && typeof row.movement_type === 'string'
    && typeof row.equipment === 'string' && typeof row.attribution === 'string'
    && typeof row.image === 'string' && typeof row.gif_url === 'string'
    && typeof row.media_id === 'string' && typeof row.created_at === 'string'
    && typeof row.body_part === 'string' && typeof row.target === 'string'
    && typeof row.muscle_group === 'string' && Array.isArray(row.secondary_muscles)
    && typeof muscles === 'object' && muscles !== null
    && ['primary', 'secondary', 'stabilizers', 'emphasis'].every((field) => Array.isArray(muscles[field])
      && (muscles[field] as unknown[]).every((item) => typeof item === 'string'))
    && Array.isArray(row.mobility_targets)
    && row.mobility_targets.every((item: unknown) => typeof item === 'string')
    && instructions !== undefined && typeof instructions.ru === 'string'
    && typeof instructions.en === 'string'
    && instructionSteps !== undefined && Array.isArray(instructionSteps.ru)
    && Array.isArray(instructionSteps.en)
    && instructionSteps.ru.every((item: unknown) => typeof item === 'string')
    && instructionSteps.en.every((item: unknown) => typeof item === 'string')
    && typeof row.anatomy_evidence === 'object' && row.anatomy_evidence !== null
    && typeof (row.anatomy_evidence as Record<string, unknown>).classification_family === 'string'
    && typeof (row.anatomy_evidence as Record<string, unknown>).basis === 'string'
    && typeof (row.anatomy_evidence as Record<string, unknown>).external_individual_match === 'boolean';
}
