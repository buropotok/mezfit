import { describe, expect, it } from 'vitest';
import { PHASE_MOTION_MS, phaseDayPosition } from './phaseDayMotion';

describe('phase day cascade', () => {
  it('starts stacked and finishes at measured slots after 400ms, regardless of card heights', () => {
    expect(PHASE_MOTION_MS).toBe(400);
    for (const slots of [[0, 100, 240], [0, 46, 920], [0], []]) {
      const maximum = Math.max(0, ...slots);
      for (const slot of slots) {
        expect(phaseDayPosition(slot, maximum, 0)).toBe(0);
        expect(phaseDayPosition(slot, maximum, 1)).toBe(slot);
        let previous = 0;
        for (let frame = 0; frame <= 100; frame++) {
          const next = phaseDayPosition(slot, maximum, frame / 100);
          expect(next).toBeGreaterThanOrEqual(previous);
          expect(next).toBeLessThanOrEqual(slot);
          previous = next;
        }
      }
    }
  });
  it('moves together, stops the second card first and leaves the third moving', () => {
    expect(phaseDayPosition(100, 400, 0.1)).toBe(phaseDayPosition(400, 400, 0.1));
    expect(phaseDayPosition(100, 400, 0.6)).toBe(100);
    expect(phaseDayPosition(400, 400, 0.6)).toBeGreaterThan(100);
    expect(phaseDayPosition(400, 400, 0.6)).toBeLessThan(400);
    expect(phaseDayPosition(0, 400, 0.6)).toBe(0);
  });
});
