import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from '../cloud/database';
import { isPublicExerciseRow, type PublicExerciseCatalogueRow, type PublicExerciseRow, type PublicTaxonomyRow } from './publicExerciseTypes';

export type PublicExerciseSnapshot =
  | { status: 'unpublished'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: null }
  | { status: 'ready'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: PublicExerciseCatalogueRow }
  | { status: 'incomplete'; exercises: PublicExerciseRow[]; taxonomy: PublicTaxonomyRow[]; catalogue: PublicExerciseCatalogueRow };

export function resolvePublicExerciseSnapshot(
  manifest: PublicExerciseCatalogueRow | undefined,
  rawExercises: unknown[],
  rawTaxonomy: PublicTaxonomyRow[],
): PublicExerciseSnapshot {
  if (!manifest) return { status: 'unpublished', exercises: [], taxonomy: [], catalogue: null };
  // Do not accidentally present a partially imported or mixed-release catalogue.
  const exercises = rawExercises.filter(isPublicExerciseRow)
    .filter((row) => row.sourceSha256 === manifest.sourceSha256);
  const taxonomy = rawTaxonomy.filter((row) => row.realmId === 'rlm-public'
    && row.owner === null && row.sourceSha256 === manifest.sourceSha256);
  if (manifest.realmId !== 'rlm-public' || manifest.owner !== null
    || manifest.schemaVersion !== '2.0.0' || !/^[a-f0-9]{64}$/.test(manifest.sourceSha256)
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
