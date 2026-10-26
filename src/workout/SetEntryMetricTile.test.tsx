// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackingType } from '../api';
import { SetEntry } from './SetEntry';
import type { SetEntryData } from './setEntryTypes';

afterEach(cleanup);

const data: SetEntryData = {
  identity: {
    programId: 'program', programName: 'Сила', exerciseDefinitionId: 'exercise',
    exerciseName: 'Жим лёжа', setNumber: 1, workoutDate: '2026-10-27',
    sourceProgramSetId: 'set', sessionSetId: null,
  },
  trackingType: 'weight_reps',
  plan: { weightKg: 57, reps: 19, durationSeconds: 125, distanceMeters: 2500 },
  previous: null,
  fact: null,
};

const scenarios: Array<{
  trackingType: TrackingType;
  cards: Array<{ accessibleName: string; label: string; value: string }>;
}> = [
  { trackingType: 'weight_reps',
    cards: [{ accessibleName: 'Изменить вес и повторения', label: 'Вес × Повторения', value: '57 кг × 19' }] },
  { trackingType: 'time',
    cards: [{ accessibleName: 'Изменить продолжительность', label: 'Продолжительность', value: '00:02:05' }] },
  { trackingType: 'time_distance',
    cards: [
      { accessibleName: 'Изменить продолжительность', label: 'Продолжительность', value: '00:02:05' },
      { accessibleName: 'Изменить дистанцию', label: 'Дистанция', value: '2 км 500 м' },
    ] },
  { trackingType: 'time_reps',
    cards: [
      { accessibleName: 'Изменить продолжительность', label: 'Продолжительность', value: '00:02:05' },
      { accessibleName: 'Изменить повторения', label: 'Повторения', value: '19' },
    ] },
  { trackingType: 'time_weight',
    cards: [
      { accessibleName: 'Изменить продолжительность', label: 'Продолжительность', value: '00:02:05' },
      { accessibleName: 'Изменить вес', label: 'Вес', value: '57 кг' },
    ] },
];

describe('shared entry metric card for exercise tracking types', () => {
  for (const mode of ['occurrence-plan', 'workout'] as const) {
    it.each(scenarios)(`uses the same glass card for $trackingType in ${mode}`, ({ trackingType, cards }) => {
      if (mode === 'occurrence-plan') {
        render(<SetEntry mode="occurrence-plan" isOpen data={{ ...data, trackingType }}
          onClose={vi.fn()} onPlanSave={vi.fn(async () => undefined)} />);
      } else {
        render(<SetEntry mode="workout" isOpen data={{ ...data, trackingType }}
          onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
      }

    const controls = screen.getAllByRole('button', { name: /^Изменить / });
    expect(controls).toHaveLength(cards.length);
    for (const { accessibleName, label, value } of cards) {
      const control = screen.getByRole('button', { name: accessibleName });
      expect(control.classList.contains('set-entry-weight-reps__metric-tile')).toBe(true);
      expect(control.getAttribute('aria-disabled')).toBe('false');
      expect(within(control).getByText(label).classList.contains('ui-text--body')).toBe(true);
      expect(within(control).getByText(value).classList.contains('ui-text--body')).toBe(true);
    }
      expect(screen.queryByText('Повторения × Вес')).toBeNull();
    });
  }
});
