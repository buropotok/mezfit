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

/** Kept pure so displaying a workout never mutates the original image or mask. */
export function renderWorkedMusclePixels(
  source: Uint8ClampedArray,
  mask: Uint8Array,
  indices: Readonly<Record<number, string>>,
  primaryIds: ReadonlySet<string>,
  secondaryIds: ReadonlySet<string>,
  showPrimary: boolean,
  showSecondary: boolean,
): Uint8ClampedArray {
  if (source.length !== mask.length * 4) throw new Error('Маска и изображение имеют разные размеры');

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

    output[offset] = role === 1 ? r : role === 2 ? Math.round(gray * 0.46 + r * 0.54) : gray;
    output[offset + 1] = role === 1 ? g : role === 2 ? Math.round(gray * 0.46 + g * 0.54) : gray;
    output[offset + 2] = role === 1 ? b : role === 2 ? Math.round(gray * 0.46 + b * 0.54) : gray;
    output[offset + 3] = source[offset + 3];
  }
  return output;
}
