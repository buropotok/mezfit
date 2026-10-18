import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clipMuscleArtworkToHitMask, FEMALE_LOWER_CHEST_ARTWORK, parseWorkedMuscleAtlasManifest,
} from './workedMuscleAtlas.ts';
import { getWorkedMuscleViewConfig } from './workedMuscleData.ts';

describe('female lower-chest replacement artwork', () => {
  it('is a real native-coordinate PNG within the female front canvas', () => {
    const data = readFileSync(new URL('../../public/' + FEMALE_LOWER_CHEST_ARTWORK.path, import.meta.url));
    const config = getWorkedMuscleViewConfig('female', 'front');
    expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(data.readUInt32BE(16)).toBe(FEMALE_LOWER_CHEST_ARTWORK.width);
    expect(data.readUInt32BE(20)).toBe(FEMALE_LOWER_CHEST_ARTWORK.height);
    expect(FEMALE_LOWER_CHEST_ARTWORK.x + FEMALE_LOWER_CHEST_ARTWORK.width).toBeLessThanOrEqual(config.width);
    expect(FEMALE_LOWER_CHEST_ARTWORK.y + FEMALE_LOWER_CHEST_ARTWORK.height).toBeLessThanOrEqual(config.height);
  });

  it('clips foreign muscle and background pixels without changing valid lower-chest artwork', () => {
    // Canvas coordinates: the replacement covers x=1..3 and y=1..2.
    // The center-top pixel belongs to pectoralis_sternal (ID 2), not lower chest.
    const nativeMask = new Uint8Array([
      0, 0, 0, 0, 0,
      0, 3, 2, 3, 0,
      0, 3, 3, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const rgba = new Uint8ClampedArray(3 * 2 * 4).fill(255);
    rgba[3] = 127; // Preserve the artwork's own semi-transparent edge.
    clipMuscleArtworkToHitMask(rgba, 3, 2, 1, 1, nativeMask, 5, 4, 3);
    expect(Array.from({ length: 6 }, (_, i) => rgba[i * 4 + 3]))
      .toEqual([127, 0, 255, 255, 255, 0]);
    // The existing tap map still identifies the new artwork's visible pixels as ID 3.
    expect(nativeMask[1 * 5 + 2]).toBe(2);
    expect(nativeMask[2 * 5 + 3]).toBe(0);
  });

  it('clips outside native canvas bounds rather than drawing untappable pixels', () => {
    const nativeMask = new Uint8Array([0, 0, 0, 3]);
    const rgba = new Uint8ClampedArray(4 * 4).fill(255);
    clipMuscleArtworkToHitMask(rgba, 2, 2, 1, 1, nativeMask, 2, 2, 3);
    expect(Array.from({ length: 4 }, (_, i) => rgba[i * 4 + 3]))
      .toEqual([255, 0, 0, 0]);
  });

  it('replaces only pectoralis_lower, without changing canonical IDs or sprite packing', () => {
    const data = JSON.parse(readFileSync(new URL('../../public/anatomy/female/front/manifest.json', import.meta.url), 'utf8'));
    const sprites = parseWorkedMuscleAtlasManifest(data, 'front', 4096, 4096, 'female');
    const lowerChest = sprites[String(FEMALE_LOWER_CHEST_ARTWORK.index)];
    expect(lowerChest.id).toBe('pectoralis_lower');
    expect(lowerChest.index).toBe(3);
    expect(FEMALE_LOWER_CHEST_ARTWORK.x).toBeLessThan(lowerChest.targetX);
    expect(FEMALE_LOWER_CHEST_ARTWORK.y).toBeLessThan(lowerChest.targetY);
    expect(sprites['1'].id).toBe('pectoralis_clavicular');
    expect(sprites['2'].id).toBe('pectoralis_sternal');
  });
});
