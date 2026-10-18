import { describe, expect, it } from 'vitest';
import { FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS, getWorkedMuscleViewConfig } from './workedMuscleData';
import { decodeWorkedMuscleMask } from './workedMuscleMask';

function preparedMask(view: 'front' | 'rear', sex: 'female' | 'male'): ArrayBuffer {
  const { width, height } = getWorkedMuscleViewConfig(sex, view);
  const buffer = new ArrayBuffer(16 + width * height);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 8; i += 1) bytes[i] = 'MEZMASK1'.charCodeAt(i);
  const header = new DataView(bytes.buffer);
  header.setUint32(8, width, true);
  header.setUint32(12, height, true);
  bytes[16 + 20 * width + 17] = 5;
  bytes[16 + (height - 1) * width + 17] = 13;
  return buffer;
}

describe('female anatomy shifted native-resolution hit maps', () => {
  it.each(['front', 'rear'] as const)('shifts %s pixel IDs to match the relocated muscle sprites', (view) => {
    const raw = preparedMask(view, 'female');
    const { width, height } = getWorkedMuscleViewConfig('female', view);
    const shift = FEMALE_WORKED_MUSCLE_VERTICAL_OFFSETS[view];
    const pixels = decodeWorkedMuscleMask(raw, view, 'female');

    expect(pixels).toHaveLength(width * height);
    expect(pixels[20 * width + 17]).toBe(0);
    expect(pixels[(20 + shift) * width + 17]).toBe(5);
    expect(pixels[(height - 1) * width + 17]).toBe(0);
    expect(pixels[shift * width - 1]).toBe(0);
  });

  it.each(['front', 'rear'] as const)('leaves male %s pixel IDs at their original coordinates', (view) => {
    const raw = preparedMask(view, 'male');
    const { width, height } = getWorkedMuscleViewConfig('male', view);
    const pixels = decodeWorkedMuscleMask(raw, view, 'male');

    expect(pixels[20 * width + 17]).toBe(5);
    expect(pixels[(height - 1) * width + 17]).toBe(13);
  });
});
