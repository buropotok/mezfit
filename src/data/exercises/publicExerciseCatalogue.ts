import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from '../cloud/database';
import { isExerciseTrackingType, isPublicCatalogueRow, isPublicExerciseRow, isPublicTaxonomyRow, type PublicExerciseCatalogueRow, type PublicExerciseRow, type PublicTaxonomyRow } from './publicExerciseTypes';

export type PublicExerciseSnapshot =
  | { status: 'unpublished'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: null }
  | { status: 'invalid'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: null }
  | { status: 'ready'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: PublicExerciseCatalogueRow }
  | { status: 'incomplete'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: PublicExerciseCatalogueRow };

export function resolvePublicExerciseSnapshot(
  manifest: unknown,
  rawExercises: unknown[],
  rawTaxonomy: unknown[],
): PublicExerciseSnapshot {
  if (manifest == null) return { status: 'unpublished', exercises: [], taxonomy: [], catalogue: null };
  if (!isPublicCatalogueRow(manifest)) return { status: 'invalid', exercises: [], taxonomy: [], catalogue: null };
  // Do not accidentally present a partially imported or mixed-release catalogue.
  const exercises = rawExercises.filter(isPublicExerciseRow)
    .filter((row) => row.sourceSha256 === manifest.sourceSha256);
  const taxonomy = rawTaxonomy.filter(isPublicTaxonomyRow)
    .filter((row) => row.realmId === 'rlm-public'
    && row.owner === null && row.sourceSha256 === manifest.sourceSha256);
  if (manifest.realmId !== 'rlm-public' || manifest.owner !== null
    || !/^[a-f0-9]{64}$/.test(manifest.sourceSha256)
    // A tracking-enabled release is not ready until EVERY exercise supplies its metric.
    || ((manifest.schemaVersion === '2.1.0' || manifest.trackingSchemaVersion === '2.1.0')
      && exercises.some((row) => !isExerciseTrackingType(row.tracking_type)))
    || manifest.exerciseCount !== 1324 || manifest.taxonomyCount !== 69
    || exercises.length !== manifest.exerciseCount || taxonomy.length !== manifest.taxonomyCount
    || new Set(exercises.map((row) => row.id)).size !== exercises.length
    || new Set(taxonomy.map((row) => row.id)).size !== taxonomy.length) {
    return { status: 'incomplete', exercises: [], taxonomy: [], catalogue: manifest };
  }
  return { status: 'ready', exercises, taxonomy, catalogue: manifest };
}

/** The only reader of locally synced public Dexie Cloud tables. Never issues REST requests. */
export class PublicExerciseCatalogueRepository {
  constructor(private readonly db: MezfitCloudDatabase) {}

  observe(
    onChange: (snapshot: PublicExerciseSnapshot) => void,
    onError: (error: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(async () => {
      const [manifest, exercises, taxonomy] = await Promise.all([
        this.db.publicExerciseCatalogues.get('mezfit:exercise-catalogue'),
        this.db.publicExerciseDefinitions.where('realmId').equals('rlm-public').toArray(),
        this.db.publicExerciseTaxonomy.where('realmId').equals('rlm-public').toArray(),
      ]);
      return resolvePublicExerciseSnapshot(manifest, exercises, taxonomy);
    }).subscribe({ next: onChange, error: onError });
  }
}
