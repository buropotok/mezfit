// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramPhaseDetails } from '../api';
import { ProgramPhaseCard } from './ProgramPhaseCard';

const phase: ProgramPhaseDetails = {
  id: 12,
  name: 'Базовая фаза',
  position: 0,
  status: 'pending',
  plannedStartDate: null,
  plannedEndDate: null,
  startedAt: null,
  finishedAt: null,
  completedExerciseCount: 0,
  exerciseCount: 0,
  progressPercent: 0,
  exercises: [],
};

afterEach(cleanup);

describe('ProgramPhaseCard actions', () => {
  it('shows actions only while expanded and confirms deletion', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onAddExercise = vi.fn();
    const { rerender } = render(
      <ProgramPhaseCard phase={phase} onDelete={onDelete} onAddExercise={onAddExercise} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ упражнение' }));
    expect(onAddExercise).toHaveBeenCalledWith(phase);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const alert = screen.getByRole('alertdialog');
    expect(within(alert).getByText('Удалить фазу?')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(12));

    rerender(
      <ProgramPhaseCard phase={phase} defaultCollapsed onDelete={onDelete} onAddExercise={onAddExercise} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть фазу' }));
    expect(screen.queryByRole('button', { name: '+ упражнение' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });
});
