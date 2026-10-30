// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackingType } from '../api';
import { SetEntry } from './SetEntry';
import { SetEntryMetricTile } from './SetEntryMetricTile';
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
        const displayed = mode === 'occurrence-plan' ? value : 'Введите факт';
        expect(within(control).getByText(displayed).classList.contains('ui-text--body')).toBe(true);
      }
      expect(screen.queryByText('Повторения × Вес')).toBeNull();
    });
  }
});

it('uses FAB press timing, fades the halo and opens on click without waiting for animation completion', () => {
  const open = vi.fn(), cancel = vi.fn();
  const view = render(<SetEntryMetricTile metric="weight_reps" value="80 кг × 12" ariaLabel="Результат" disabled={false} onClick={open} />);
  const button = screen.getByRole('button', { name: 'Результат' });
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(button, 'animate', { configurable: true, value: animate });
  fireEvent.pointerDown(button);
  expect(animate).toHaveBeenNthCalledWith(1, [
    { scale: '1', easing: 'ease-out' },
    { scale: '0.95', offset: 120 / 530, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
    { scale: '1' },
  ], { duration: 530 });
  expect(animate).toHaveBeenNthCalledWith(2, [
    { '--ui-glass-surface-halo-opacity': '1', easing: 'ease-out' },
    { '--ui-glass-surface-halo-opacity': '0.03', offset: 120 / 530, easing: 'ease-in-out' },
    { '--ui-glass-surface-halo-opacity': '1' },
  ], { duration: 530 });
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(open).toHaveBeenCalledOnce();
  view.rerender(<SetEntryMetricTile metric="weight_reps" value="80 кг × 12" ariaLabel="Результат" disabled onClick={open} />);
  fireEvent.pointerDown(button); fireEvent.click(button);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledOnce();
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
});
