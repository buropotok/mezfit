import type {
  FlexAttributeInput, FlexResolvedValue, FlexEntityTarget, FlexAttributesRepository,
} from '../data/cloud/flex-attributes';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import type { HsvColor } from '../ui/colorMath';

export interface ResistanceBandSetting {
  readonly id: 1 | 2 | 3 | 4 | 5;
  readonly color: string;
  readonly min: number;
  readonly max: number;
}

export const RESISTANCE_BAND_DEFAULTS: readonly ResistanceBandSetting[] = Object.freeze([
  { id: 1, color: '#49DF7B', min: 2, max: 5 },
  { id: 2, color: '#9FC5E8', min: 6, max: 9 },
  { id: 3, color: '#E7A91B', min: 10, max: 13 },
  { id: 4, color: '#FF6B6B', min: 14, max: 17 },
  { id: 5, color: '#9BAABA', min: 18, max: 21 },
]);

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export type ResistanceBandField = 'color' | 'min' | 'max';
export type ResistanceBandFieldKey = `Band_${ResistanceBandSetting['id']}_${ResistanceBandField}`;
export const bandFieldKey = (id: ResistanceBandSetting['id'], field: ResistanceBandField): ResistanceBandFieldKey =>
  `Band_${id}_${field}`;

export function assertResistanceBands(bands: readonly ResistanceBandSetting[]): void {
  if (bands.length !== RESISTANCE_BAND_DEFAULTS.length) throw new Error('INVALID_BAND_SETTINGS');
  for (const [index, band] of bands.entries()) {
    if (band.id !== RESISTANCE_BAND_DEFAULTS[index].id
      || !COLOR_PATTERN.test(band.color)
      || !Number.isInteger(band.min) || !Number.isInteger(band.max)
      || band.min < 1 || band.max > 30 || band.min > band.max) {
      throw new Error('INVALID_BAND_SETTINGS');
    }
  }
}

/** Invalid remote values are ignored rather than propagated into the picker. */
export function resolveResistanceBands(values: readonly FlexResolvedValue[]): ResistanceBandSetting[] {
  return RESISTANCE_BAND_DEFAULTS.map(defaults => {
    const color = values.find(row => row.key === bandFieldKey(defaults.id, 'color'));
    const min = values.find(row => row.key === bandFieldKey(defaults.id, 'min'));
    const max = values.find(row => row.key === bandFieldKey(defaults.id, 'max'));
    const resolved = {
      ...defaults,
      color: color?.valueType === 'string' && typeof color.value === 'string'
        && COLOR_PATTERN.test(color.value) ? color.value.toUpperCase() : defaults.color,
      min: min?.valueType === 'number' && typeof min.value === 'number'
        ? min.value : defaults.min,
      max: max?.valueType === 'number' && typeof max.value === 'number'
        ? max.value : defaults.max,
    };
    return Number.isInteger(resolved.min) && Number.isInteger(resolved.max)
      && resolved.min >= 1 && resolved.max <= 30 && resolved.min <= resolved.max
      ? resolved : { ...defaults };
  });
}

type BandRepository = Pick<FlexAttributesRepository<MezfitCloudDatabase>, 'getValues' | 'setValues'>;
export function personalBandTarget(actorUserId: string): FlexEntityTarget {
  if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_BAND_ACTOR');
  return { entityType: 'user', entityId: actorUserId, realmId: actorUserId };
}

export async function loadResistanceBands(repo: BandRepository, actorUserId: string): Promise<ResistanceBandSetting[]> {
  return resolveResistanceBands(await repo.getValues(personalBandTarget(actorUserId)));
}

/**
 * Persist only deviations from built-in defaults, and clear former overrides
 * with null when restored. No business FACT or session row is touched.
 */
export async function saveResistanceBands(
  repo: BandRepository,
  actorUserId: string,
  bands: readonly ResistanceBandSetting[],
  dirtyFields: ReadonlySet<ResistanceBandFieldKey>,
): Promise<void> {
  assertResistanceBands(bands);
  if (dirtyFields.size === 0) return;
  const target = personalBandTarget(actorUserId);
  const stored = await repo.getValues(target);
  // Validate against the latest locally synchronized palette, not stale UI
  // values. This also detects incompatible concurrent range updates.
  const current = resolveResistanceBands(stored);
  const merged = mergeResistanceBands(current, bands, dirtyFields);
  assertResistanceBands(merged);
  const entries: FlexAttributeInput[] = [];
  for (const band of bands) {
    const defaults = RESISTANCE_BAND_DEFAULTS[band.id - 1];
    for (const field of ['color', 'min', 'max'] as const) {
      const key = bandFieldKey(band.id, field);
      if (!dirtyFields.has(key)) continue;
      const type = field === 'color' ? 'string' : 'number';
      const value = field === 'color' ? band.color.toUpperCase() : band[field];
      const defaultValue = defaults[field];
      const saved = stored.find(row => row.key === key && row.valueType === type);
      const desired = value === defaultValue ? null : value;
      if (saved?.value === desired || (!saved && desired === null)) continue;
      entries.push({ key, valueType: type, value: desired });
    }
  }
  if (entries.length) await repo.setValues(target, entries);
}

/** Preserve edited fields and refresh untouched fields from the current realm. */
export function mergeResistanceBands(
  latest: readonly ResistanceBandSetting[],
  draft: readonly ResistanceBandSetting[],
  dirtyFields: ReadonlySet<ResistanceBandFieldKey>,
): ResistanceBandSetting[] {
  assertResistanceBands(latest);
  assertResistanceBands(draft);
  return latest.map((band, index) => {
    const edited = draft[index];
    const merged = { ...band };
    for (const field of ['color', 'min', 'max'] as const) {
      if (dirtyFields.has(bandFieldKey(band.id, field))) {
        if (field === 'color') merged.color = edited.color;
        else if (field === 'min') merged.min = edited.min;
        else merged.max = edited.max;
      }
    }
    return merged;
  });
}

/** Convert palette color to the existing UI Kit HSV color wheel inputs. */
export function resistanceHexToHsv(hex: string): HsvColor {
  if (!COLOR_PATTERN.test(hex)) throw new Error('INVALID_BAND_COLOR');
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  let hue = 0;
  if (delta !== 0) {
    if (high === r) hue = ((g - b) / delta) % 6;
    else if (high === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return {
    hue: (hue * 60 + 360) % 360,
    saturation: high === 0 ? 0 : delta / high * 100,
    value: high * 100,
  };
}
