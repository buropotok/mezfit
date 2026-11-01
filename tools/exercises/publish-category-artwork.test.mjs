import { describe, expect, it } from 'vitest';
import {
  validateCategoryArtworkManifest, validateCategoryAsset, planCategoryArtworkPublication,
} from './publish-category-artwork.mjs';

function webp() {
  const bytes = Buffer.alloc(24);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8 ', 12, 'ascii');
  return bytes;
}
const categories = ['chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio'];
const files = {
  chest: 'public/muscles_chest.webp',
  arms: 'public/muscles_arm.webp',
  back: 'public/muscles_back.webp',
  legs: 'public/muscles_leg.webp',
  shoulders: 'public/muscles_shoulders.webp',
  core: 'public/muscles_core.webp',
  full_body: 'public/muscles_fullbody.webp',
  cardio: 'public/gym-keeper/categories/muscles_cardio.svg',
};
const manifest = {
  table: 'publicExerciseCategoryArtworks', realmId: 'rlm-public',
  assets: categories.map(category => ({ category, file: files[category],
    mime: category === 'cardio' ? 'image/svg+xml' : 'image/webp' })),
};

describe('protected artwork publication', () => {
  it('permits exactly eight checked-in source paths and correct mime', () => {
    expect(validateCategoryArtworkManifest(manifest)).toHaveLength(8);
    expect(() => validateCategoryArtworkManifest({ ...manifest, realmId: 'rlm-user' })).toThrow();
    expect(() => validateCategoryArtworkManifest({ ...manifest,
      assets: [...manifest.assets, { category: 'other', file: 'elsewhere.png', mime: 'image/png' }] })).toThrow();
    const asset = validateCategoryAsset('chest', 'image/webp', webp());
    expect(asset.id).toBe('category-artwork:chest');
    expect(asset.version).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateCategoryAsset('chest', 'image/webp', Buffer.alloc(24))).toThrow();
    expect(() => validateCategoryAsset('cardio', 'image/svg+xml', Buffer.from('<script>alert(1)</script>'))).toThrow();
  });

  it('publishes missing only and fails closed on conflicting existing blobs', () => {
    const assets = categories.map(category => ({
      category, id: 'category-artwork:' + category, version: 'b'.repeat(64),
      mime: category === 'cardio' ? 'image/svg+xml' : 'image/webp', size: 24,
    }));
    expect(planCategoryArtworkPublication([], assets)).toHaveLength(8);
    expect(() => planCategoryArtworkPublication([{
      id: 'category-artwork:chest', category: 'chest', realmId: 'rlm-public', owner: null,
      version: 'c'.repeat(64), mime: 'image/webp', size: 24,
      image: { _bt: 'Blob', ref: '1:abc123def456', size: 24, ct: 'image/webp' }, _hasBlobRefs: 1,
    }], assets)).toThrow('CONFLICTING_PUBLIC_CATEGORY_ARTWORK_ROW');
  });
});
