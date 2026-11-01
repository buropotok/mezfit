import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CATEGORY_ARTWORK_IDS, isPublicCategoryArtworkRow,
} from './publicCategoryArtwork';

function row(category: string = 'chest', image: unknown = new Blob(['image bytes example'], { type: 'image/webp' })) {
  return {
    id: 'category-artwork:' + category, category, realmId: 'rlm-public', owner: null,
    version: 'a'.repeat(64), mime: 'image/webp', size: 19, image,
  };
}

describe('synced public exercise category artwork', () => {
  it('covers the eight real image categories and not the static other icon', () => {
    expect(PUBLIC_CATEGORY_ARTWORK_IDS).toEqual([
      'chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio',
    ]);
  });

  it('accepts a fully hydrated, scoped and verified Blob', () => {
    const image = new Blob(['image bytes example'], { type: 'image/webp' });
    expect(isPublicCategoryArtworkRow({ ...row(), image, size: image.size })).toBe(true);
  });

  it('does not display pending BlobRefs, foreign rows or wrong versions', () => {
    expect(isPublicCategoryArtworkRow(row('chest', {
      _bt: 'Blob', ref: '1:abc123def456', size: 19, ct: 'image/webp',
    }))).toBe(false);
    expect(isPublicCategoryArtworkRow({ ...row(), realmId: 'rlm-foreign' })).toBe(false);
    expect(isPublicCategoryArtworkRow({ ...row(), id: 'category-artwork:arms' })).toBe(false);
    expect(isPublicCategoryArtworkRow({ ...row(), version: 'old' })).toBe(false);
    expect(isPublicCategoryArtworkRow({ ...row(), size: 1 })).toBe(false);
    expect(isPublicCategoryArtworkRow({ ...row(), mime: 'image/svg+xml' })).toBe(false);
  });
});
