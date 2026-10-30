import { describe, expect, it, vi } from 'vitest';
import { hsvToHex } from '../ui/colorMath';
import type { FlexAttributeInput, FlexEntityTarget, FlexResolvedValue } from '../data/cloud/flex-attributes';
import {
  RESISTANCE_BAND_DEFAULTS,
  assertResistanceBands,
  loadResistanceBands,
  mergeResistanceBands,
  personalBandTarget,
  resistanceHexToHsv,
  resolveResistanceBands,
  saveResistanceBands,
  type ResistanceBandFieldKey,
} from './resistanceBands';

const edited = (...fields: ResistanceBandFieldKey[]): ReadonlySet<ResistanceBandFieldKey> => new Set(fields);

function fakeRepo(initial: FlexResolvedValue[] = []) {
  const entries = new Map(initial.map(row => [row.key, row]));
  const getValues = vi.fn(async (_target: FlexEntityTarget) => [...entries.values()]);
  const setValues = vi.fn(async (_target: FlexEntityTarget, input: readonly FlexAttributeInput[]) => {
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
    bands[1] = { ...bands[1], min: 4, max: 11 };
    bands[3] = { ...bands[3], color: '#123ABC' };
    await saveResistanceBands(repo, 'tg:2', bands, edited('Band_2_min', 'Band_2_max', 'Band_4_color'));
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
    await saveResistanceBands(repo, 'tg:2', bands, edited('Band_2_min', 'Band_2_max', 'Band_4_color'));
    expect(repo.setValues).toHaveBeenCalledOnce();
  });

  it('clears changed values using null when resetting the defaults, never deletes rows', async () => {
    const repo = fakeRepo([{ key: 'Band_1_min', valueType: 'number', value: 1 }]);
    const bands = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    await saveResistanceBands(repo, 'tg:42', bands, edited('Band_1_min'));
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
      await expect(saveResistanceBands(repo, 'tg:42', bands, edited('Band_1_min'))).rejects.toThrow('INVALID_BAND_SETTINGS');
    }
    expect(repo.setValues).not.toHaveBeenCalled();
  });

  it('preserves an untouched remote color even when the editor has stale defaults', async () => {
    const repo = fakeRepo([{ key: 'Band_4_color', valueType: 'string', value: '#123ABC' }]);
    const staleDraft = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    staleDraft[1] = { ...staleDraft[1], min: 4, max: 11 };
    await saveResistanceBands(repo, 'tg:42', staleDraft, edited('Band_2_min', 'Band_2_max'));
    expect(repo.setValues).toHaveBeenCalledOnce();
    expect(repo.setValues).toHaveBeenCalledWith(personalBandTarget('tg:42'), [
      { key: 'Band_2_min', valueType: 'number', value: 4 },
      { key: 'Band_2_max', valueType: 'number', value: 11 },
    ]);
    expect((await loadResistanceBands(repo, 'tg:42'))[3].color).toBe('#123ABC');
  });

  it('merges only untouched remote settings into an actively edited draft', () => {
    const old = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    const newest = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    newest[3] = { ...newest[3], color: '#123ABC' };
    old[1] = { ...old[1], min: 4, max: 11 };
    const merged = mergeResistanceBands(newest, old, edited('Band_2_min', 'Band_2_max'));
    expect(merged[1]).toEqual(old[1]);
    expect(merged[3].color).toBe('#123ABC');
  });

  it('refuses an incompatible concurrent range update without issuing a partial write', async () => {
    const repo = fakeRepo([{ key: 'Band_2_max', valueType: 'number', value: 6 }]);
    const draft = RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band }));
    draft[1] = { ...draft[1], min: 8 };
    await expect(saveResistanceBands(repo, 'tg:42', draft, edited('Band_2_min')))
      .rejects.toThrow('INVALID_BAND_SETTINGS');
    expect(repo.setValues).not.toHaveBeenCalled();
  });

  it('does not write any preferences without an explicit user edit', async () => {
    const repo = fakeRepo([{ key: 'Band_4_color', valueType: 'string', value: '#123ABC' }]);
    await saveResistanceBands(
      repo, 'tg:42', RESISTANCE_BAND_DEFAULTS,
      edited(),
    );
    expect(repo.getValues).not.toHaveBeenCalled();
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
