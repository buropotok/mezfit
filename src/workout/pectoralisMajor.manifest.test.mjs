import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPectoralisMajorSprites, parseWorkedMuscleAtlasManifest } from './workedMuscleAtlas.ts';
import { getWorkedMuscleViewConfig, PECTORALIS_MAJOR_PART_IDS } from './workedMuscleData.ts';

describe('Pectoralis major real atlas manifests', () => {
  it('produces six virtual male pectoralis-major sprites without changing the male assets', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/anatomy/front/manifest.json', import.meta.url), 'utf8'));
    const parsed = parseWorkedMuscleAtlasManifest(manifest, 'front', 4096, 4096, 'male');
    const aliases = createPectoralisMajorSprites(parsed, getWorkedMuscleViewConfig('male', 'front').width);
    expect(aliases).toHaveLength(6);
    expect(aliases.every((sprite) => sprite.id === 'pectoralis_major')).toBe(true);
    for (const id of PECTORALIS_MAJOR_PART_IDS) {
      const source = Object.values(parsed).find((sprite) => sprite.id === id);
      const slices = aliases.filter((sprite) => sprite.index === source?.index);
      expect(slices).toHaveLength(2);
      expect(slices[0].width + slices[1].width).toBe(source?.width);
    }
  });

  it('keeps three original female 3/4 chest zones and three separate full-size aggregate copies', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/anatomy/female/front/manifest.json', import.meta.url), 'utf8'));
    const parsed = parseWorkedMuscleAtlasManifest(manifest, 'front', 4096, 4096, 'female');
    const originals = PECTORALIS_MAJOR_PART_IDS.map((id) => Object.values(parsed).find((sprite) => sprite.id === id));
    const aliases = Object.values(parsed).filter((sprite) => sprite.id === 'pectoralis_major');
    expect(originals.every(Boolean)).toBe(true);
    expect(aliases).toHaveLength(3);
    aliases.forEach((copy, index) => {
      const original = originals[index];
      expect(copy.index).not.toBe(original.index);
      expect([copy.targetX, copy.targetY, copy.width, copy.height])
        .toEqual([original.targetX, original.targetY, original.width, original.height]);
    });
  });
});
