import { WORKED_MUSCLE_VIEWS, type WorkedMuscleView } from './workedMuscleData';

const HEADER_BYTES = 16;
const MAGIC = 'MEZMASK1';

/** Decode the saved binary format without interpolating or remapping pixel IDs. */
export function decodeWorkedMuscleMask(buffer: ArrayBuffer, view: WorkedMuscleView): Uint8Array {
  const { width, height } = WORKED_MUSCLE_VIEWS[view];
  const expectedLength = HEADER_BYTES + width * height;
  if (buffer.byteLength !== expectedLength) {
    throw new Error(`Некорректный размер маски ${view}: ${buffer.byteLength} вместо ${expectedLength}`);
  }

  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC.charCodeAt(index)) {
      throw new Error(`Неверная сигнатура маски ${view}`);
    }
  }

  const header = new DataView(buffer);
  if (header.getUint32(8, true) !== width || header.getUint32(12, true) !== height) {
    throw new Error(`Размеры маски ${view} не совпадают с изображением`);
  }
  return bytes.subarray(HEADER_BYTES);
}

/** Neutralize the inactive anatomy with the approved front/rear tone settings.
 * Local variation survives as fibre detail; no image or mask bytes are changed.
 */
export function createNeutralWorkedMusclePixels(
  source: Uint8ClampedArray,
  mask: Uint8Array,
  smoothingPercent: number,
): Uint8ClampedArray {
  if (source.length !== mask.length * 4) throw new Error('Маска и изображение имеют разные размеры');
  const smooth = Math.max(0, Math.min(100, smoothingPercent)) / 100;
  const sums = new Float64Array(256);
  const counts = new Uint32Array(256);
  const gray = new Uint8Array(mask.length);
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    if (source[p + 3] === 0) continue;
    const y = Math.round(0.299 * source[p] + 0.587 * source[p + 1] + 0.114 * source[p + 2]);
    gray[i] = y;
    const id = mask[i];
    if (id !== 0) { sums[id] += y; counts[id] += 1; }
  }
  const means = new Float32Array(256);
  for (let id = 1; id < 256; id += 1) {
    if (counts[id] !== 0) means[id] = sums[id] / counts[id];
  }
  const strength = 0.12 + smooth * 0.83;
  const detailScale = 0.72 - smooth * 0.34;
  const baseContrast = 0.93 - smooth * 0.08;
  const baseLift = 182 + smooth * 6;
  const output = new Uint8ClampedArray(source.length);
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    const alpha = source[p + 3];
    output[p + 3] = alpha;
    if (alpha === 0) continue;
    const y = gray[i];
    const id = mask[i];
    const base = (y - 128) * baseContrast + baseLift;
    const equalized = id && counts[id] ? 186 + (y - means[id]) * detailScale : base;
    const tone = id && counts[id] ? base * (1 - strength) + equalized * strength : base;
    const value = Math.max(0, Math.min(255, Math.round(tone)));
    output[p] = value;
    output[p + 1] = value;
    output[p + 2] = value;
  }
  return output;
}

/** Kept pure so displaying a workout never mutates the original image or mask. */
export function renderWorkedMusclePixels(
  source: Uint8ClampedArray,
  mask: Uint8Array,
  indices: Readonly<Record<number, string>>,
  primaryIds: ReadonlySet<string>,
  secondaryIds: ReadonlySet<string>,
  showPrimary: boolean,
  showSecondary: boolean,
  neutral?: Uint8ClampedArray,
): Uint8ClampedArray {
  if (source.length !== mask.length * 4) throw new Error('Маска и изображение имеют разные размеры');
  if (neutral && neutral.length !== source.length) throw new Error('Некорректный нейтральный слой');

  const roles = new Uint8Array(256);
  for (const [indexText, muscleId] of Object.entries(indices)) {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 1 || index > 255) continue;
    if (showPrimary && primaryIds.has(muscleId)) roles[index] = 1;
    else if (showSecondary && secondaryIds.has(muscleId)) roles[index] = 2;
  }

  const output = new Uint8ClampedArray(source.length);
  for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
    const role = roles[mask[pixel]];
    const r = source[offset];
    const g = source[offset + 1];
    const b = source[offset + 2];
    const gray = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);

    const inactiveR = neutral ? neutral[offset] : gray;
    const inactiveG = neutral ? neutral[offset + 1] : gray;
    const inactiveB = neutral ? neutral[offset + 2] : gray;
    output[offset] = role === 1 ? r : role === 2 ? Math.round(inactiveR * 0.46 + r * 0.54) : inactiveR;
    output[offset + 1] = role === 1 ? g : role === 2 ? Math.round(inactiveG * 0.46 + g * 0.54) : inactiveG;
    output[offset + 2] = role === 1 ? b : role === 2 ? Math.round(inactiveB * 0.46 + b * 0.54) : inactiveB;
    output[offset + 3] = source[offset + 3];
  }
  return output;
}
