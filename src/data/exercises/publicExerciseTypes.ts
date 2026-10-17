/** Valid exercise result metrics; shared by the new catalogue and workout snapshots. */
export type ExerciseTrackingType = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';

/** SHA-256 of the immutable v2.1 tracking source in private R2. */
export const TRACKING_RELEASE_SHA256 = 'ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66';

const VALID_EXERCISE_TRACKING_TYPES: readonly string[] = [
  'weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight',
];

export function isExerciseTrackingType(value: unknown): value is ExerciseTrackingType {
  return typeof value === 'string' && VALID_EXERCISE_TRACKING_TYPES.includes(value);
}

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
  schemaVersion: '2.0.0' | '2.1.0';
  catalogue: 'mezfit.exercise_catalog.ru_anatomy';
  sourceSha256: string;
  /** Additive tracking update; keep schemaVersion/sourceSha256 v2.0 for old clients. */
  trackingSchemaVersion?: '2.1.0';
  trackingReleaseSha256?: string;
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
    && typeof row.subcategory === 'string' && typeof row.subcategory_ru === 'string'
    && typeof row.movement_type === 'string'
    // Tracking is intentionally not checked here. v2.0 programme authoring may
    // receive unknown legacy tracking metadata; v2.1 activation validates it.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** Dexie tables are typed at compile-time, but synced rows still cross a trust boundary. */
export function isPublicTaxonomyRow(value: unknown): value is PublicTaxonomyRow {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0
    && value.realmId === 'rlm-public' && value.owner === null
    && typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256)
    && typeof value.category_ru === 'string'
    && typeof value.subcategory_ru === 'string'
    && typeof value.anatomical_description_ru === 'string'
    && typeof value.kind === 'string'
    && ['muscle', 'group', 'head', 'part', 'zone', 'function'].includes(value.kind)
    && (value.parent_id === null || typeof value.parent_id === 'string');
}

export function isPublicCatalogueRow(value: unknown): value is PublicExerciseCatalogueRow {
  if (!isRecord(value)) return false;
  return value.id === 'mezfit:exercise-catalogue'
    && value.realmId === 'rlm-public' && value.owner === null
    && (value.schemaVersion === '2.0.0' || value.schemaVersion === '2.1.0')
    && value.catalogue === 'mezfit.exercise_catalog.ru_anatomy'
    && typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256)
    && value.exerciseCount === 1324 && value.taxonomyCount === 69
    && ((value.trackingSchemaVersion === undefined && value.trackingReleaseSha256 === undefined)
      || (value.trackingSchemaVersion === '2.1.0'
        && value.trackingReleaseSha256 === TRACKING_RELEASE_SHA256))
    && isStringMap(value.subcategoryLabelsRu)
    && isStringMap(value.movementFamilyReferences)
    && isRecord(value.metadata)
    && typeof value.publishedAt === 'string' && value.publishedAt.length > 0;
}
