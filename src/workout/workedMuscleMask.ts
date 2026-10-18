import {
  FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS, getWorkedMuscleViewConfig,
  type WorkedMuscleSex, type WorkedMuscleView,
} from './workedMuscleData';

const HEADER_BYTES = 16;
const MAGIC = 'MEZMASK1';

/** Decode the saved binary format without interpolating or remapping pixel IDs. */
export function decodeWorkedMuscleMask(buffer: ArrayBuffer, view: WorkedMuscleView, sex: WorkedMuscleSex = 'male'): Uint8Array {
  const { width, height } = getWorkedMuscleViewConfig(sex, view);
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
  const pixels = bytes.subarray(HEADER_BYTES);
  if (sex === 'male') return pixels;

  // The female neutral figures and manifest targets are shifted down without
  // scaling any muscle. Translate the exact pixel IDs once when loading, rather
  // than stretching the masks or changing the native male mask contract.
  const offset = FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS[view];
  const shifted = new Uint8Array(width * height);
  shifted.set(pixels.subarray(0, width * (height - offset)), width * offset);
  return shifted;
}

