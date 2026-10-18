import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS, getWorkedMuscleViewConfig,
} from './workedMuscleData.ts';

describe('shifted female anatomy assets', () => {
  it.each([
    ['front', 'pectoralis_clavicular', 276],
    ['rear', 'latissimus_dorsi', 334],
  ])('keeps the %s atlas, neutral PNG, and shifted sprite targets aligned', (view, firstId, originalY) => {
    const directory = new URL(`../../public/anatomy/female/${view}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
    const png = readFileSync(new URL('neutral.png', directory));
    const config = getWorkedMuscleViewConfig('female', view);
    const offset = FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS[view];

    // PNG IHDR dimensions, without pulling an image decoder into tests.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(config.width);
    expect(png.readUInt32BE(20)).toBe(config.height);
    expect([manifest.width, manifest.height]).toEqual([config.width, config.height]);
    expect(manifest.sprites['1'].id).toBe(firstId);
    expect(manifest.sprites['1'].targetY).toBe(originalY + offset);

    for (const [key, sprite] of Object.entries(manifest.sprites)) {
      expect(sprite.id).toBe(config.indices[key]);
      expect(sprite.targetX + sprite.width).toBeLessThanOrEqual(config.width);
      expect(sprite.targetY + sprite.height).toBeLessThanOrEqual(config.height);
    }
  });
});
