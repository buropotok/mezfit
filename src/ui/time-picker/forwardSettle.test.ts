import { describe, expect, it } from 'vitest';
import { forwardSettledIndex } from './forwardSettle';

describe('forward-only post-momentum alignment', () => {
  it('always advances when the last native scroll moved downward', () => {
    expect(forwardSettledIndex(10.1 * 36, 36, 1, 60)).toBe(11);
    expect(forwardSettledIndex(10.9 * 36, 36, 1, 60)).toBe(11);
    expect(forwardSettledIndex(10 * 36, 36, 1, 60)).toBe(10);
  });

  it('always retreats when the last native scroll moved upward', () => {
    expect(forwardSettledIndex(10.1 * 36, 36, -1, 60)).toBe(10);
    expect(forwardSettledIndex(10.9 * 36, 36, -1, 60)).toBe(10);
    expect(forwardSettledIndex(10 * 36, 36, -1, 60)).toBe(10);
  });

  it('never leaves finite hour or minute boundaries', () => {
    expect(forwardSettledIndex(23 * 36, 36, 1, 24)).toBe(23);
    expect(forwardSettledIndex(59 * 36, 36, 1, 60)).toBe(59);
    expect(forwardSettledIndex(0, 36, -1, 60)).toBe(0);
  });

  it('uses nearest-row only when no movement direction was recorded', () => {
    expect(forwardSettledIndex(10.2 * 36, 36, 0, 60)).toBe(10);
    expect(forwardSettledIndex(10.8 * 36, 36, 0, 60)).toBe(11);
  });
});
