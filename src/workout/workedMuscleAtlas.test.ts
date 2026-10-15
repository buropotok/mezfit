import { describe, expect, it } from 'vitest';
import { parseWorkedMuscleAtlasManifest, pickWorkedMuscleAt } from './workedMuscleAtlas';

const rearSprite = {
  index: 14,
  id: 'latissimus_dorsi',
  label: 'Широчайшие',
  category: 'Спина',
  atlasX: 30, atlasY: 15,
  targetX: 200, targetY: 300,
  width: 100, height: 180,
};

describe('WorkedMuscles prepared atlas manifest', () => {
  const manifest = {
    view: 'rear',
    width: 1122,
    height: 1402,
    tonePercent: 59,
    sprites: { '14': rearSprite },
  };

  it('accepts valid aligned coordinates and canonical view-specific IDs', () => {
    const sprites = parseWorkedMuscleAtlasManifest(manifest, 'rear', 400, 300);
    expect(sprites['14']).toMatchObject(rearSprite);
  });

  it('refuses stale or mismapped view assets', () => {
    expect(() => parseWorkedMuscleAtlasManifest({ ...manifest, tonePercent: 84 }, 'rear', 400, 300)).toThrow();
    expect(() => parseWorkedMuscleAtlasManifest({
      ...manifest, sprites: { '14': { ...rearSprite, id: 'pectoralis_sternal' } },
    }, 'rear', 400, 300)).toThrow('ID');
  });

  it('rejects out-of-range atlas and body coordinates', () => {
    expect(() => parseWorkedMuscleAtlasManifest(manifest, 'rear', 110, 300)).toThrow('границы');
    expect(() => parseWorkedMuscleAtlasManifest({
      ...manifest, sprites: { '14': { ...rearSprite, targetX: 1100 } },
    }, 'rear', 400, 300)).toThrow('границы');
  });
});

describe('WorkedMuscles native pixel tapping', () => {
  const rect = { left: 20, top: 40, width: 200, height: 100 };
  const mask = new Uint8Array([0, 14, 14, 0, 3, 0, 0, 3]);

  it('reads the exact ID of the touched pixel at the rendered scale', () => {
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 95, 50)).toBe(14);
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 45, 90)).toBe(3);
  });

  it('does not choose other muscles in a sprite bounding rectangle', () => {
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 45, 50)).toBe(0);
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 95, 90)).toBe(0);
  });

  it('ignores taps outside the image, empty rectangles and invalid masks', () => {
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 19, 50)).toBe(0);
    expect(pickWorkedMuscleAt(mask, 4, 2, rect, 220, 50)).toBe(0);
    expect(pickWorkedMuscleAt(mask, 4, 2, { ...rect, width: 0 }, 50, 50)).toBe(0);
    expect(pickWorkedMuscleAt(mask, 3, 2, rect, 95, 50)).toBe(0);
  });
});
