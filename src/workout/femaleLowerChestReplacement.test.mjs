import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEMALE_LOWER_CHEST_ARTWORK, parseWorkedMuscleAtlasManifest } from './workedMuscleAtlas.ts';
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
