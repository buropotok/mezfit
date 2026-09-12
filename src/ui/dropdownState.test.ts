import { describe, expect, it } from 'vitest';
import { beginMultiDraft, commitMultiDraft, toggleMultiDraft } from './dropdownState';

describe('Dropdown multi-select lifecycle', () => {
  it('initializes an independent draft from the controlled value', () => {
    const value = ['strength'];
    const draft = beginMultiDraft(value);

    expect(draft).toEqual(['strength']);
    expect(draft).not.toBe(value);
  });

  it('adds and removes values without mutating the previous draft', () => {
    const initial = ['strength'];
    const added = toggleMultiDraft(initial, 'cardio');
    const removed = toggleMultiDraft(added, 'strength');

    expect(initial).toEqual(['strength']);
    expect(added).toEqual(['strength', 'cardio']);
    expect(removed).toEqual(['cardio']);
  });

  it('commits a snapshot instead of exposing mutable draft state', () => {
    const draft = ['strength', 'cardio'];
    const committed = commitMultiDraft(draft);

    expect(committed).toEqual(draft);
    expect(committed).not.toBe(draft);
  });
});
