import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from '../cloud/database';

export const PUBLIC_CATEGORY_ARTWORK_IDS = [
  'chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio',
] as const;

export type PublicCategoryArtworkId = typeof PUBLIC_CATEGORY_ARTWORK_IDS[number];

export interface PublicCategoryArtworkRow {
  id: string;
  realmId: 'rlm-public';
  owner: null;
  category: PublicCategoryArtworkId;
  version: string;
  mime: 'image/webp' | 'image/svg+xml';
  size: number;
  /** Dexie Cloud Addon resolves authorized BlobRefs into locally cached Blob values. */
  image: unknown;
}

const categories = new Set<string>(PUBLIC_CATEGORY_ARTWORK_IDS);
const IMAGE_LIMIT = 100_000;

export function isPublicCategoryArtworkRow(value: unknown): value is PublicCategoryArtworkRow & { image: Blob } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.category === 'string' && categories.has(row.category)
    && row.id === 'category-artwork:' + row.category
    && row.realmId === 'rlm-public' && row.owner === null
    && typeof row.version === 'string' && /^[a-f0-9]{64}$/.test(row.version)
    && (row.mime === 'image/webp' || (row.category === 'cardio' && row.mime === 'image/svg+xml'))
    && typeof row.size === 'number' && Number.isInteger(row.size)
    && row.size >= 16 && row.size <= IMAGE_LIMIT
    && row.image instanceof Blob && row.image.type === row.mime
    && row.image.size === row.size;
}

/** Cloud Addon owns blob download, permissions and persistence. This reader never fetches media. */
export class PublicCategoryArtworkRepository {
  constructor(private readonly db: Pick<MezfitCloudDatabase, 'publicExerciseCategoryArtworks'>) {}

  async read(): Promise<PublicCategoryArtworkRow[]> {
    return this.db.publicExerciseCategoryArtworks.where('realmId').equals('rlm-public').toArray();
  }

  observe(onChange: (rows: PublicCategoryArtworkRow[]) => void, onError: (error: unknown) => void) {
    return liveQuery(() => this.read()).subscribe({ next: onChange, error: onError });
  }
}
