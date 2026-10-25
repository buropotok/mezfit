import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getWorkedMuscleViewConfig, PECTORALIS_MAJOR_PART_IDS } from './workedMuscleData.ts';
import { parseWorkedMuscleAtlasManifest } from './workedMuscleAtlas.ts';

const frontDirectory = new URL('../../public/anatomy/female/front/', import.meta.url);
const rearDirectory = new URL('../../public/anatomy/female/rear/', import.meta.url);

function dimensions(png) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('approved female 3/4 atlas media', () => {
  it('uses the native 1024 × 1536 underlay, matching front atlas cells and canonical IDs', () => {
    const config = getWorkedMuscleViewConfig('female', 'front');
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', frontDirectory), 'utf8'));
    const neutral = readFileSync(new URL('neutral.png', frontDirectory));
    const color = readFileSync(new URL('color-atlas.png', frontDirectory));

    expect(dimensions(neutral)).toEqual([1024, 1536]);
    expect([config.width, config.height]).toEqual([1024, 1536]);
    expect([manifest.width, manifest.height, manifest.view, manifest.tonePercent])
      .toEqual([1024, 1536, 'front', null]);
    const [atlasWidth, atlasHeight] = dimensions(color);
    const sprites = parseWorkedMuscleAtlasManifest(manifest, 'front', atlasWidth, atlasHeight, 'female');
    expect(Object.keys(sprites)).toHaveLength(40);
    expect(Object.keys(config.indices)).toHaveLength(40);
    expect(PECTORALIS_MAJOR_PART_IDS.map((id) => Object.values(sprites).find((sprite) => sprite.id === id)?.id))
      .toEqual([...PECTORALIS_MAJOR_PART_IDS]);
    expect(sprites['40'].id).toBe('brachioradialis');
  });

  it('keeps pectoralis-major copies out of touch IDs so the three original chest zones stay selectable', () => {
    const { width, height } = getWorkedMuscleViewConfig('female', 'front');
    const data = readFileSync(new URL('mask.mezmask', frontDirectory));
    expect(data.subarray(0, 8).toString('ascii')).toBe('MEZMASK1');
    expect(data.readUInt32LE(8)).toBe(width);
    expect(data.readUInt32LE(12)).toBe(height);
    expect(data.length).toBe(16 + width * height);
    const ids = data.subarray(16);
    const counts = new Uint32Array(41);
    let highestId = 0;
    for (const id of ids) {
      if (id > highestId) highestId = id;
      if (id < counts.length) counts[id] += 1;
    }
    expect(highestId).toBeLessThanOrEqual(40);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[7]).toBeGreaterThan(0);
    expect(counts[21]).toBeGreaterThan(0);
    expect(counts[40]).toBeGreaterThan(0);
    expect(Array.from(counts.slice(37, 40))).toEqual([0, 0, 0]);
  });

  it('replaces only the female rear neutral while preserving its original geometry', () => {
    const config = getWorkedMuscleViewConfig('female', 'rear');
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', rearDirectory), 'utf8'));
    const neutral = readFileSync(new URL('neutral.png', rearDirectory));
    expect(dimensions(neutral)).toEqual([1086, 1448]);
    expect([manifest.width, manifest.height]).toEqual([config.width, config.height]);
    expect(manifest.sprites['1'].id).toBe('latissimus_dorsi');
  });
});
