import { describe, expect, it, vi } from 'vitest';
import { hsvToHex } from '../ui/colorMath';
import {
  RESISTANCE_BAND_DEFAULTS,
  assertResistanceBands,
  loadResistanceBands,
  personalBandTarget,
  resistanceHexToHsv,
  resolveResistanceBands,
  saveResistanceBands,
} from './resistanceBands';

function fakeRepo(initial: Array<{ key: string; valueType: 'string' | 'number'; value: string | number | null }> = []) {
  const entries = new Map(initial.map(row => [row.key, row]));
  const getValues = vi.fn(async () => [...entries.values()]);
  const setValues = vi.fn(async (_target: unknown, input: Array<{ key: string; valueType: 'string' | 'number'; value: string | number | null }>) => {
    input.forEach(row => entries.set(row.key, row));
  });
  return { getValues, setValues };
}

describe('personal resistance bands over Flex Attributes', () => {
  it('uses the five approved colors and ranges without creating remote data', async () => {
    const repo = fakeRepo();
    expect(await loadResistanceBands(repo, 'tg:123')).toEqual(RESISTANCE_BAND_DEFAULTS);
    expect(repo.getValues).toHaveBeenCalledWith(personalBandTarget('tg:123'));
    expect(repo.setValues).not.toHaveBeenCalled();
    expect(RESISTANCE_BAND_DEFAULTS.map(band => [band.min, band.max]))
      .toEqual([[2, 5], [6, 9], [10, 13], [14, 17], [18, 21]]);
  });

  it('writes only user-modified attributes as one Flex transaction', async () => {
    const repo = fakeRepo();
    const bands = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    bands[1].min = 4;
    bands[1].max = 11;
    bands[3].color = '#123ABC';
    await saveResistanceBands(repo, 'tg:2', bands);
    expect(repo.setValues).toHaveBeenCalledOnce();
    expect(repo.setValues).toHaveBeenCalledWith(
      personalBandTarget('tg:2'),
      [
        { key: 'Band_2_min', valueType: 'number', value: 4 },
        { key: 'Band_2_max', valueType: 'number', value: 11 },
        { key: 'Band_4_color', valueType: 'string', value: '#123ABC' },
      ],
    );
    expect(await loadResistanceBands(repo, 'tg:2')).toEqual(bands);
    await saveResistanceBands(repo, 'tg:2', bands);
    expect(repo.setValues).toHaveBeenCalledOnce();
  });

  it('clears changed values using null when resetting the defaults, never deletes rows', async () => {
    const repo = fakeRepo([{ key: 'Band_1_min', valueType: 'number', value: 1 }]);
    const bands = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    await saveResistanceBands(repo, 'tg:42', bands);
    expect(repo.setValues).toHaveBeenCalledWith(
      personalBandTarget('tg:42'), [{ key: 'Band_1_min', valueType: 'number', value: null }],
    );
    expect(await loadResistanceBands(repo, 'tg:42')).toEqual(bands);
  });

  it('rejects invalid ranges and leaves the persisted values untouched', async () => {
    const repo = fakeRepo();
    for (const invalid of [{ min: 0 }, { max: 31 }, { min: 20, max: 10 }, { min: 1.5 }, { color: 'blue' }]) {
      const bands = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
      Object.assign(bands[0], invalid);
      await expect(saveResistanceBands(repo, 'tg:42', bands)).rejects.toThrow('INVALID_BAND_SETTINGS');
    }
    expect(repo.setValues).not.toHaveBeenCalled();
  });

  it('ignores malformed cloud override values without breaking UI', () => {
    const values = resolveResistanceBands([
      { key: 'Band_1_min', valueType: 'number', value: -9 },
      { key: 'Band_1_color', valueType: 'string', value: 'invalid' },
      { key: 'Band_2_max', valueType: 'number', value: 29 },
    ]);
    expect(values[0]).toEqual(RESISTANCE_BAND_DEFAULTS[0]);
    expect(values[1].max).toBe(29);
  });

  it('uses the existing color wheel without changing or approximating stored RGB values', () => {
    for (const band of RESISTANCE_BAND_DEFAULTS) {
      expect(hsvToHex(resistanceHexToHsv(band.color))).toBe(band.color);
    }
  });

  it('cannot load values from a foreign or unverified personal realm', async () => {
    const repo = fakeRepo();
    await expect(loadResistanceBands(repo, 'invalid')).rejects.toThrow('INVALID_BAND_ACTOR');
    expect(repo.getValues).not.toHaveBeenCalled();
  });
});
