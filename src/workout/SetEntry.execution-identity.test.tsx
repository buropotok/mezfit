// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { SetEntry } from './SetEntry';
import type { SetEntryData } from './setEntryTypes';

afterEach(cleanup);
it.each(['weight_reps', 'time'] as const)('%s keeps drafts separate for equal labels with different execution set IDs', trackingType => {
  const data: SetEntryData = { identity: { programId: 'program', programName: 'Сила', exerciseDefinitionId: 'catalogue',
    exerciseName: 'Упражнение', setNumber: 1, workoutDate: '2026-11-07', sourceProgramSetId: 'plan-set', sessionSetId: 'execution-set-a' },
    trackingType, plan: null, previous: null, fact: { metrics: { weightKg: 50, reps: 8, durationSeconds: 30, distanceMeters: null },
      setLabel: null, rpe: 8, comment: 'Первый FACT', bands: [] } };
  const fact = data.fact;
  if (!fact) throw Error('Missing FACT fixture');
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();
  const editor = (value: SetEntryData) => <KonstaProvider theme="ios" dark>
    <SetEntry mode="workout" isOpen data={value} onClose={onClose} onSave={onSave} />
  </KonstaProvider>;
  const view = render(editor(data));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Черновик первого' } });
  view.rerender(editor({ ...data, identity: { ...data.identity, sessionSetId: 'execution-set-b' },
    fact: { ...fact, comment: 'Второй FACT' } }));
  expect(screen.getByDisplayValue('Второй FACT')).toBeTruthy();
  expect(screen.queryByDisplayValue('Черновик первого')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Открыть чат' })).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});
