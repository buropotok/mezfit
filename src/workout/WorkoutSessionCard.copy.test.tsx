// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    SortableList: ({ header, footer }: { header: ReactNode; footer: ReactNode }) =>
      <div>{header}{footer}</div>,
    LiquidPopover: ({ trigger, items, onPresentationChange }: {
      trigger: ReactNode;
      items: { id: string; label: string; icon?: string; disabled?: boolean; onSelect?: () => void }[];
      onPresentationChange?: (presented: boolean) => void;
    }) => <div>{trigger}<div role="menu">
      {items.map(item => <button key={item.id} data-icon={item.icon} disabled={item.disabled}
        onClick={() => item.onSelect?.()}>{item.label}</button>)}
      <button onClick={() => onPresentationChange?.(false)}>Закрыть меню</button>
    </div></div>,
    DatePicker: ({ opened, onChange, onClose }: {
      opened: boolean; onChange: (date: string) => void; onClose: () => void;
    }) => opened ? <div role="dialog" aria-label="Выбор даты">
      <button onClick={() => { onChange('2026-11-09'); onClose(); }}>9 ноября</button>
    </div> : null,
  };
});

const session: ActiveWorkoutSession = {
  sessionId: 12, occurrenceId: null, status: 'completed',
  workoutDate: '2026-11-02', startedAt: '2026-11-02T08:00:00.000Z',
  completedAt: '2026-11-02T09:00:00.000Z',
  program: null, phase: null, day: null, exercises: [],
};
afterEach(cleanup);

describe('session copy menu', () => {
  it('opens the existing side date picker only after the menu closes and delegates selected date', async () => {
    const onCopy = vi.fn(async (_date: string) => undefined);
    render(<WorkoutSessionCard session={session} onCopy={onCopy}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => undefined)} />);
    const copy = screen.getByRole('button', { name: 'Скопировать тренировку' });
    expect(copy.getAttribute('data-icon')).toBe('copy-plus');
    fireEvent.click(copy);
    expect(screen.queryByRole('dialog', { name: 'Выбор даты' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть меню' }));
    fireEvent.click(screen.getByRole('button', { name: '9 ноября' }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy).toHaveBeenCalledWith('2026-11-09');
    expect(screen.queryByRole('dialog', { name: 'Выбор даты' })).toBeNull();
    expect((await screen.findByRole('status')).textContent).toContain('Копия тренировки добавлена');
  });

  it('does not offer duplication when the owner has no copy capability', () => {
    render(<WorkoutSessionCard session={session}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => undefined)} />);
    expect(screen.queryByRole('button', { name: 'Скопировать тренировку' })).toBeNull();
  });
});
