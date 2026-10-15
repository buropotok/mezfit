import { describe, expect, it } from 'vitest';
import { WORKED_MUSCLE_VIEWS } from './workedMuscleData';
import { decodeWorkedMuscleMask } from './workedMuscleMask';

function makeMask(view: 'front' | 'rear') {
  const { width, height } = WORKED_MUSCLE_VIEWS[view];
  const bytes = new Uint8Array(16 + width * height);
  for (let i = 0; i < 8; i += 1) bytes[i] = 'MEZMASK1'.charCodeAt(i);
  const header = new DataView(bytes.buffer);
  header.setUint32(8, width, true);
  header.setUint32(12, height, true);
  bytes[16] = 20;
  bytes[bytes.length - 1] = 9;
  return bytes;
}

describe('WorkedMuscles binary pixel hit maps', () => {
  it.each(['front', 'rear'] as const)('preserves %s native-resolution IDs', (view) => {
    const bytes = makeMask(view);
    const ids = decodeWorkedMuscleMask(bytes.buffer, view);
    expect(ids.length).toBe(WORKED_MUSCLE_VIEWS[view].width * WORKED_MUSCLE_VIEWS[view].height);
    expect(ids[0]).toBe(20);
    expect(ids[ids.length - 1]).toBe(9);
  });

  it('rejects corrupt or mismatched masks rather than stretching them', () => {
    const bytes = makeMask('front');
    expect(() => decodeWorkedMuscleMask(bytes.buffer, 'rear')).toThrow();
    bytes[0] = 0;
    expect(() => decodeWorkedMuscleMask(bytes.buffer, 'front')).toThrow('сигнатура');
  });
});
