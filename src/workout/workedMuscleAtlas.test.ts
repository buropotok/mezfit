import { describe, expect, it } from 'vitest';
import { WORKED_MUSCLE_VIEWS } from './workedMuscleData';
import { muscleIdAtPixel, parseAtlasManifest } from './workedMuscleAtlas';

describe('WorkedMuscles atlas hit testing', () => {
  const mask = new Uint8Array([
    0, 0, 5, 0,
    0, 5, 5, 0,
    0, 0, 0, 0,
  ]);

  it('returns the exact saved pixel, not any sprite bounding rectangle', () => {
    expect(muscleIdAtPixel(mask, 4, 3, 2, 0)).toBe(5);
    expect(muscleIdAtPixel(mask, 4, 3, 1, 1)).toBe(5);
    expect(muscleIdAtPixel(mask, 4, 3, 1, 0)).toBe(0);
    expect(muscleIdAtPixel(mask, 4, 3, 3, 1)).toBe(0);
  });

  it('rejects out-of-bounds taps and malformed map sizes', () => {
    expect(muscleIdAtPixel(mask, 4, 3, -1, 1)).toBe(0);
    expect(muscleIdAtPixel(mask, 4, 3, 4, 1)).toBe(0);
    expect(muscleIdAtPixel(mask, 4, 3, 1, 3)).toBe(0);
    expect(muscleIdAtPixel(mask, 4, 3, 1.5, 0)).toBe(0);
    expect(muscleIdAtPixel(new Uint8Array(1), 4, 3, 0, 0)).toBe(0);
  });
});

describe('WorkedMuscles atlas manifests', () => {
  const config = WORKED_MUSCLE_VIEWS.front;
  const sample = {
    version: 'v3',
    view: 'front',
    width: config.width,
    height: config.height,
    tonePercent: 84,
    atlasWidth: 64,
    atlasHeight: 64,
    sprites: {
      '6': {
        index: 6, id: 'rectus_abdominis', label: 'Прямая мышца живота',
        targetX: 30, targetY: 90, atlasX: 8, atlasY: 12,
        width: 20, height: 20, pixels: 145,
      },
    },
  };

  it('accepts known view-specific muscle IDs with in-bounds sprite rectangles', () => {
    const sprites = parseAtlasManifest(sample, 'front', 64, 64);
    expect(sprites[6]?.id).toBe('rectus_abdominis');
    expect(sprites[6]?.targetX).toBe(30);
  });

  it('rejects mismatched views, tones, dimensions and out-of-bounds rectangles', () => {
    expect(() => parseAtlasManifest(sample, 'rear', 64, 64)).toThrow('Несовместимый');
    expect(() => parseAtlasManifest({ ...sample, tonePercent: 82 }, 'front', 64, 64)).toThrow();
    expect(() => parseAtlasManifest({ ...sample, atlasWidth: 65 }, 'front', 64, 64)).toThrow();
    expect(() => parseAtlasManifest({ ...sample, sprites: {
      '6': { ...sample.sprites[6], targetX: config.width - 10 },
    } }, 'front', 64, 64)).toThrow('координаты');
  });

  it('rejects a semantically wrong ID even when numeric geometry is valid', () => {
    expect(() => parseAtlasManifest({ ...sample, sprites: {
      '6': { ...sample.sprites[6], id: 'brachialis' },
    } }, 'front', 64, 64)).toThrow('координаты');
  });

  it('rejects unknown sprite IDs rather than rendering them over other muscles', () => {
    expect(() => parseAtlasManifest({ ...sample, sprites: {
      ...sample.sprites,
      '255': { ...sample.sprites[6], index: 255, id: 'fake' },
    } }, 'front', 64, 64)).toThrow('неизвестные');
  });
});
