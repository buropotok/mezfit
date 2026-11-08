// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SortableListProps } from '../ui/SortableList';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import { WorkoutSessionCard } from './WorkoutSessionCard';

const discussion = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('../discussions/useEntityDiscussions', () => ({
  useEntityDiscussions: () => ({
    content: null,
    open: discussion.open,
    canOpen: true,
    unread: 2,
    openTarget: vi.fn(),
    menuItem: { id: 'discussion', label: 'Обсуждения', onSelect: vi.fn() },
    onMenuPresentationChange: vi.fn(),
  }),
}));

vi.mock('../ui', async importOriginal => ({
  ...await importOriginal<typeof import('../ui')>(),
  SortableList: ({ header, footer }: SortableListProps) => <section>{header}{footer}</section>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  IconButton: ({ label, onClick }: { label: string; onClick?: () => void }) =>
    <button aria-label={label} type="button" onClick={onClick}>{label}</button>,
}));

const session = (status: 'active' | 'completed'): ActiveWorkoutSession<string> => ({
  sessionId: 'session-1',
  occurrenceId: null,
  status,
  workoutDate: '2026-11-08',
  startedAt: '2026-11-08T08:00:00.000Z',
  completedAt: status === 'completed' ? '2026-11-08T09:00:00.000Z' : null,
  program: null,
  phase: null,
  day: null,
  exercises: [],
  discussion: {
    scope: { realmId: 'relationship-1', coachClientId: 'relationship-1' },
    anchor: { kind: 'workout', workout: { kind: 'session', id: 'session-1' } },
  },
});

function SheetCard({ status }: { status: 'active' | 'completed' }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <>
    <header>
      <span>Тренировка</span>
      <div ref={setHost} data-testid="sheet-actions" />
    </header>
    <WorkoutSessionCard session={session(status)} headerActionsHost={host} showStatus={false}
      onCopy={async () => {}} onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />
  </>;
}

afterEach(() => { cleanup(); discussion.open.mockClear(); });

it.each(['active', 'completed'] as const)(
  'moves the same FACT discussion/menu controls to the %s sheet header without duplicating them',
  status => {
    const view = render(<SheetCard status={status} />);
    const slot = screen.getByTestId('sheet-actions');
    const cardHeader = view.container.querySelector('.workout-session-card__header--sheet');

    expect(slot.querySelectorAll('button')).toHaveLength(2);
    expect(slot.querySelector('[aria-label="Обсуждения тренировки"]')).toBeTruthy();
    expect(slot.querySelector('[aria-label="Меню тренировки"]')).toBeTruthy();
    expect(cardHeader?.querySelector('button')).toBeNull();
    expect(cardHeader?.querySelector('[aria-label="Атлет: Создатель тренировки"]')).toBeTruthy();
    expect(screen.queryByText(status === 'completed' ? 'Завершена' : 'Запущена')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения тренировки' }));
    expect(discussion.open).toHaveBeenCalledOnce();
  },
);

it('keeps discussion and menu inside the standalone FACT card when no sheet slot is supplied', () => {
  const view = render(<WorkoutSessionCard session={session('active')}
    onCopy={async () => {}} onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />);
  const cardHeader = view.container.querySelector('.workout-session-card__header');
  expect(cardHeader?.querySelector('[aria-label="Обсуждения тренировки"]')).toBeTruthy();
  expect(cardHeader?.querySelector('[aria-label="Меню тренировки"]')).toBeTruthy();
  expect(screen.getByText('Запущена')).toBeTruthy();
});
