import { TRAINING_FORMAT } from '../adapters/training';

// Source tuples, deliberately different from the canonical output contract.
export function trainingFixture() {
  return { format: TRAINING_FORMAT,
    people: [['p', 'Synthetic Person'], ['q', 'Other Person']],
    exercises: [['bench', 'Source press', 'load'], ['hold', 'Source hold', 'duration']],
    templates: [
      ['p1', 'p', [['phase', 'Phase']], [['day', 'phase', [['pe', 'bench', [['ps', 10, 80, 'kg']]]]]]],
      ['p2', 'q', [], [['day2', null, [['pe2', 'hold', [['ps2', null, null, null]]]]]]],
    ],
    appointments: [['w', 'p', 'p1', 'day', '2026-10-14', [
      ['oe', 'bench', 'pe', [['os', '?', [10, 25, 'kg', null, null, null, null]]]],
    ]]],
    history: [
      ['s', 'p', 'p1', 'w', '2026-10-14', [
        ['se', 'bench', 'pe', [['ss', 'ps', [10, 25, 'kg', null, null, null, null]]]],
      ], [['fe', 'bench', [['fs', 'ss', [8, 20, 'kg', null, null, null, null]]]]]],
      ['ad', 'p', null, null, '2026-10-15', null,
        [['afe', 'hold', [['afs', null, [null, null, null, 30, null, null, null]]]]]],
    ], measures: 2,
  };
}
