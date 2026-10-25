import { describe, expect, it } from 'vitest';
import { SET_TYPES, SET_TYPE_LABELS, isSetType } from './set-type';

describe('specialized set technique contract', () => {
  it('accepts exactly the six named techniques from the approved SetEntry prototype', () => {
    expect(SET_TYPES).toEqual([
      'dropset', 'isometrics', 'cluster', 'rest_pause',
      'tempo_superset', 'partial_reps',
    ]);
    for (const type of SET_TYPES) {
      expect(isSetType(type)).toBe(true);
      expect(SET_TYPE_LABELS[type]).toBeTruthy();
    }
    expect(isSetType('warmup')).toBe(false);
    expect(isSetType('hard')).toBe(false);
    expect(isSetType('normal')).toBe(false);
    expect(isSetType('drop')).toBe(false);
    expect(isSetType(null)).toBe(false);
    expect(isSetType({ type: 'dropset' })).toBe(false);
  });
});
