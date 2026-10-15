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

