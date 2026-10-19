import { isExerciseDefinition } from '../../../shared/exercise-definition';
import type { ExerciseTrackingType, PublicExercise } from '../../../shared/exercise-types';
export type { ExerciseTrackingType, PublicExercise } from '../../../shared/exercise-types';

/** SHA-256 of the immutable v2.1 tracking source in private R2. */
export const TRACKING_RELEASE_SHA256 = 'ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66';
const TRACKING_BASE_SOURCE_SHA256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';

const VALID_EXERCISE_TRACKING_TYPES: readonly string[] = [
  'weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight',
];

export function isExerciseTrackingType(value: unknown): value is ExerciseTrackingType {
  return typeof value === 'string' && VALID_EXERCISE_TRACKING_TYPES.includes(value);
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

/** Public catalogue storage metadata is separate from definition payload validation. */
export function isPublicExerciseRow(value: unknown): value is PublicExerciseRow {
  if (!isExerciseDefinition(value)) return false;
  const row = value as PublicExercise & Record<string, unknown>;
  return /^\d{4}$/.test(row.id) && row.realmId === 'rlm-public' && row.owner === null
    && typeof row.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sourceSha256);
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
      || (value.schemaVersion === '2.0.0'
        && value.sourceSha256 === TRACKING_BASE_SOURCE_SHA256
        && value.trackingSchemaVersion === '2.1.0'
        && value.trackingReleaseSha256 === TRACKING_RELEASE_SHA256))
    && isStringMap(value.subcategoryLabelsRu)
    && isStringMap(value.movementFamilyReferences)
    && isRecord(value.metadata)
    && typeof value.publishedAt === 'string' && value.publishedAt.length > 0;
}
