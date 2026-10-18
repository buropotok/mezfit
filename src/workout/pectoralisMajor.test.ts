// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anatomyMuscleIds } from '../exercises/ExerciseCatalogContent';
import { workedMuscleHighlightRole } from './WorkedMuscles';
import {
  createPectoralisMajorSprites, parseWorkedMuscleAtlasManifest, type AtlasSprite,
} from './workedMuscleAtlas';
import {
  getWorkedMuscleViewConfig, PECTORALIS_MAJOR_PART_IDS, WORKED_MUSCLE_LABELS,
} from './workedMuscleData';

describe('Pectoralis major catalogue-to-atlas contract', () => {
  it('passes the real exercise catalogue ID without accepting unrelated deep muscles', () => {
    expect(anatomyMuscleIds(['pectoralis_major', 'transversus_abdominis', 'pectoralis_major']))
      .toEqual(['pectoralis_major']);
    expect(WORKED_MUSCLE_LABELS.pectoralis_major).toBe('Большая грудная мышца');
  });

  it.each(['male', 'female'] as const)(
    'reuses both sides of all three original %s front zones as six alias sprites',
    (sex) => {
      const width = getWorkedMuscleViewConfig(sex, 'front').width;
      const center = Math.floor(width / 2);
      const sprites: Record<string, AtlasSprite> = {};
      PECTORALIS_MAJOR_PART_IDS.forEach((id, i) => {
        sprites[String(i + 1)] = {
          index: i + 1, id, label: id, category: 'Грудь',
          atlasX: i * 120, atlasY: 0,
          targetX: center - 50, targetY: i * 30, width: 100, height: 20,
        };
      });

      const copies = createPectoralisMajorSprites(sprites, width);
      expect(copies).toHaveLength(6);
      for (let i = 0; i < 3; i += 1) {
        const left = copies[i * 2];
        const right = copies[i * 2 + 1];
        const original = sprites[String(i + 1)];
        expect([left.id, right.id]).toEqual(['pectoralis_major', 'pectoralis_major']);
        expect([left.width, right.width]).toEqual([50, 50]);
        expect([left.targetX, right.targetX]).toEqual([original.targetX, center]);
        expect([left.atlasX, right.atlasX]).toEqual([original.atlasX, original.atlasX + 50]);
        expect(left.index).toBe(original.index);
        expect(right.index).toBe(original.index);
        expect(original.id).toBe(PECTORALIS_MAJOR_PART_IDS[i]);
      }
    },
  );

  it.each(['male', 'female'] as const)(
    'produces six pectoralis_major sprites from the real %s manifest', (sex) => {
      const relativePath = sex === 'male'
        ? '../../public/anatomy/front/manifest.json'
        : '../../public/anatomy/female/front/manifest.json';
      const manifest: unknown = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
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

  it('preserves source priority and visibility toggles for aggregate or individual selections', () => {
    const primary = new Set(['pectoralis_major']);
    const secondary = new Set(['pectoralis_sternal']);
    expect(workedMuscleHighlightRole('pectoralis_major', primary, secondary, true, true)).toBe('primary');
    expect(workedMuscleHighlightRole('pectoralis_sternal', primary, secondary, true, true)).toBe('secondary');
    expect(workedMuscleHighlightRole('pectoralis_major', primary, secondary, false, true)).toBeNull();
    expect(workedMuscleHighlightRole('pectoralis_sternal', primary, secondary, false, true)).toBe('secondary');
  });
});
