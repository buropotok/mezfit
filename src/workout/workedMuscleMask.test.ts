import { describe, expect, it } from 'vitest';
import { WORKED_MUSCLE_VIEWS } from './workedMuscleData';
import { createNeutralWorkedMusclePixels, decodeWorkedMuscleMask, renderWorkedMusclePixels } from './workedMuscleMask';

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

describe('WorkedMuscles binary masks', () => {
  it.each(['front', 'rear'] as const)('reads %s saved IDs without remapping', (view) => {
    const bytes = makeMask(view);
    const ids = decodeWorkedMuscleMask(bytes.buffer, view);
    expect(ids.length).toBe(WORKED_MUSCLE_VIEWS[view].width * WORKED_MUSCLE_VIEWS[view].height);
    expect(ids[0]).toBe(20);
    expect(ids[ids.length - 1]).toBe(9);
  });

  it('rejects corrupted and mismatched masks rather than rescaling', () => {
    const bytes = makeMask('front');
    expect(() => decodeWorkedMuscleMask(bytes.buffer, 'rear')).toThrow();
    bytes[0] = 0;
    expect(() => decodeWorkedMuscleMask(bytes.buffer, 'front')).toThrow('сигнатура');
  });
});

describe('WorkedMuscles display roles', () => {
  const pixels = new Uint8ClampedArray([
    240, 40, 20, 255, // primary
    40, 160, 240, 255, // secondary
    10, 190, 80, 255, // unselected
  ]);
  const mask = new Uint8Array([1, 2, 3]);
  const indices = { 1: 'primary', 2: 'secondary', 3: 'unselected' };
  const primary = new Set(['primary']);
  const secondary = new Set(['secondary']);

  it('shows primary in full color, secondary muted, and the rest grayscale', () => {
    const rendered = renderWorkedMusclePixels(pixels, mask, indices, primary, secondary, true, true);
    expect(Array.from(rendered.slice(0, 4))).toEqual([240, 40, 20, 255]);
    const secondaryGray = Math.round(40 * 0.2126 + 160 * 0.7152 + 240 * 0.0722);
    expect(Array.from(rendered.slice(4, 8))).toEqual([
      Math.round(secondaryGray * 0.46 + 40 * 0.54),
      Math.round(secondaryGray * 0.46 + 160 * 0.54),
      Math.round(secondaryGray * 0.46 + 240 * 0.54),
      255,
    ]);
    expect(rendered[8]).toBe(rendered[9]);
    expect(rendered[9]).toBe(rendered[10]);
    expect(Array.from(pixels.slice(0, 4))).toEqual([240, 40, 20, 255]);
  });

  it('hides each role independently without mutating input pixels', () => {
    const hiddenPrimary = renderWorkedMusclePixels(pixels, mask, indices, primary, secondary, false, true);
    expect(hiddenPrimary[0]).toBe(hiddenPrimary[1]);
    const hiddenSecondary = renderWorkedMusclePixels(pixels, mask, indices, primary, secondary, true, false);
    expect(hiddenSecondary[4]).toBe(hiddenSecondary[5]);
    expect(hiddenSecondary[5]).toBe(hiddenSecondary[6]);
    expect(hiddenSecondary[0]).toBe(240);
    const allHidden = renderWorkedMusclePixels(pixels, mask, indices, primary, secondary, false, false);
    expect(allHidden[0]).toBe(allHidden[1]);
    expect(allHidden[4]).toBe(allHidden[5]);
  });

  it('gives visible primary priority if a muscle appears in both arrays', () => {
    const output = renderWorkedMusclePixels(pixels, mask, indices, primary, new Set(['primary', 'secondary']), true, true);
    expect(output[0]).toBe(240);
    const secondaryOnly = renderWorkedMusclePixels(pixels, mask, indices, primary, new Set(['primary']), false, true);
    expect(secondaryOnly[0]).not.toBe(240);
  });
});


describe('WorkedMuscles approved inactive anatomy tone', () => {
  it('normalizes different muscle color groups without erasing local fiber contrast', () => {
    const source = new Uint8ClampedArray([
      210, 25, 25, 255,
      150, 15, 15, 255,
      15, 25, 220, 255,
      8, 10, 125, 255,
    ]);
    const mask = new Uint8Array([1, 1, 2, 2]);
    const sourceCopy = source.slice();
    const maskCopy = mask.slice();
    const inactive = createNeutralWorkedMusclePixels(source, mask, 84);
    for (let i = 0; i < 4; i += 1) {
      expect(inactive[i * 4]).toBe(inactive[i * 4 + 1]);
      expect(inactive[i * 4 + 1]).toBe(inactive[i * 4 + 2]);
    }
    expect(inactive[0]).not.toBe(inactive[4]);
    expect(inactive[8]).not.toBe(inactive[12]);
    expect(Array.from(source)).toEqual(Array.from(sourceCopy));
    expect(Array.from(mask)).toEqual(Array.from(maskCopy));
    const rendered = renderWorkedMusclePixels(
      source, mask, { 1: 'one', 2: 'two' }, new Set(['one']), new Set(), true, true, inactive,
    );
    expect(Array.from(rendered.slice(0, 4))).toEqual(Array.from(source.slice(0, 4)));
    expect(Array.from(rendered.slice(8, 12))).toEqual(Array.from(inactive.slice(8, 12)));
  });

  it('uses the selected smoothing strength and preserves alpha', () => {
    const source = new Uint8ClampedArray([230, 20, 20, 255, 130, 30, 20, 255, 0, 0, 0, 0]);
    const mask = new Uint8Array([1, 1, 0]);
    const soft = createNeutralWorkedMusclePixels(source, mask, 59);
    const strong = createNeutralWorkedMusclePixels(source, mask, 84);
    expect(Array.from(soft)).not.toEqual(Array.from(strong));
    expect(soft[11]).toBe(0);
    expect(strong[11]).toBe(0);
  });
});
