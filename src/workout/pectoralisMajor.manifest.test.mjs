import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPectoralisMajorSprites, parseWorkedMuscleAtlasManifest } from './workedMuscleAtlas.ts';
import { getWorkedMuscleViewConfig, PECTORALIS_MAJOR_PART_IDS } from './workedMuscleData.ts';

describe('Pectoralis major real atlas manifests', () => {
  it.each(['male', 'female'])(
    'produces six pectoralis_major sprites from the real %s manifest', (sex) => {
      const relativePath = sex === 'male'
        ? '../../public/anatomy/front/manifest.json'
        : '../../public/anatomy/female/front/manifest.json';
      const manifest = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
      const parsed = parseWorkedMuscleAtlasManifest(manifest, 'front', 4096, 4096, sex);
      const aliases = createPectoralisMajorSprites(parsed, getWorkedMuscleViewConfig(sex, 'front').width);
      expect(aliases).toHaveLength(6);
      expect(aliases.map((sprite) => sprite.id)).toEqual(Array(6).fill('pectoralis_major'));
      for (const id of PECTORALIS_MAJOR_PART_IDS) {
        const source = Object.values(parsed).find((sprite) => sprite.id === id);
        expect(source).toBeDefined();
        const slices = aliases.filter((sprite) => sprite.index === source?.index);
        expect(slices).toHaveLength(2);
        expect(slices[0].width + slices[1].width).toBe(source?.width);
      }
    },
  );
});
