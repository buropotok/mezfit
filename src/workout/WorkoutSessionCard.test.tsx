// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  type SortableListProps = React.ComponentProps<typeof actual.SortableList>;
  type LiquidPopoverProps = React.ComponentProps<typeof actual.LiquidPopover>;

  function TestSortableList({ items, header, footer, disabled }: SortableListProps) {
    return (
      <div data-testid="workout-card" data-disabled={disabled ? 'true' : 'false'}>
        <div>{header}</div>
        <div>{items.map((item) => <div key={item.id}>{item.content}</div>)}</div>
        <div>{footer}</div>
      </div>
    );
  }

  function TestLiquidPopover({
    trigger,
    items,
    label,
    onPresentationChange,
  }: LiquidPopoverProps) {
    return (
      <div>
        {trigger}
        <div role="menu" aria-label={label}>
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => item.onSelect?.()}>
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="finish-popover-presentation"
          onClick={() => onPresentationChange?.(false)}
        >
          Finish popover presentation
        </button>
      </div>
    );
  }

  return {
    ...actual,
    SortableList: TestSortableList,
    LiquidPopover: TestLiquidPopover,
  };
});

const baseSession: ActiveWorkoutSession = {
  sessionId: 501,
  occurrenceId: null,
  status: 'active',
  workoutDate: '2026-10-07',
  startedAt: '2026-10-08T12:00:00Z',
  completedAt: null,
  program: null,
  phase: null,
  day: null,
  creator: null,
  exercises: [],
};

const requiredProps = {
  onReorderExerciseIds: vi.fn(),
  onSaveSet: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkoutSessionCard capability ownership', () => {
  it('does not render unsupported actions in production-like mode', () => {
    render(<WorkoutSessionCard session={baseSession} {...requiredProps} />);

    expect(screen.queryByRole('button', { name: 'Меню тренировки' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Комментарий' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить упражнение' })).toBeNull();
  });

  it('keeps completed sessions read-only even when structural callbacks exist', () => {
    render(
      <WorkoutSessionCard
        session={{
          ...baseSession,
          status: 'completed',
          completedAt: '2026-10-08T13:00:00Z',
        }}
        {...requiredProps}
        onAddExercise={vi.fn()}
        onAddSet={vi.fn()}
        onEditResults={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workout-card').getAttribute('data-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Добавить упражнение' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Редактировать результаты' })).toBeTruthy();
  });

  it('does not claim a renamed title until the owner reconciles the canonical prop', async () => {
    let resolveRename: (() => void) | null = null;
    const onRename = vi.fn(() => new Promise<void>((resolve) => {
      resolveRename = resolve;
    }));

    const view = render(
      <WorkoutSessionCard
        session={baseSession}
        title="Старая тренировка"
        {...requiredProps}
        onRename={onRename}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить название' }));
    fireEvent.click(screen.getByTestId('finish-popover-presentation'));

    const input = await screen.findByDisplayValue('Старая тренировка');
    fireEvent.change(input, { target: { value: 'Новое название' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onRename).toHaveBeenCalledWith('Новое название');
    expect(screen.getByText('Старая тренировка')).toBeTruthy();

    await act(async () => resolveRename?.());
    await waitFor(() => expect(screen.getByDisplayValue('Старая тренировка')).toBeTruthy());
    expect(screen.getByText('Старая тренировка')).toBeTruthy();

    view.rerender(
      <WorkoutSessionCard
        session={baseSession}
        title="Новое название"
        {...requiredProps}
        onRename={onRename}
      />,
    );
    expect(screen.getByText('Новое название')).toBeTruthy();
  });

  it('reopens comments from the canonical prop instead of a locally assumed save', async () => {
    let resolveComment: (() => void) | null = null;
    const onCommentChange = vi.fn(() => new Promise<void>((resolve) => {
      resolveComment = resolve;
    }));

    const { container } = render(
      <WorkoutSessionCard
        session={baseSession}
        comment="Исходный комментарий"
        {...requiredProps}
        onCommentChange={onCommentChange}
      />,
    );

    const commentButton = container.querySelector<HTMLButtonElement>('.workout-session-card__comment-button');
    expect(commentButton).not.toBeNull();
    fireEvent.click(commentButton!);
    const textarea = screen.getByPlaceholderText('Комментарий к тренировке');
    expect((textarea as HTMLTextAreaElement).value).toBe('Исходный комментарий');

    fireEvent.change(textarea, { target: { value: 'Новый комментарий' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onCommentChange).toHaveBeenCalledWith('Новый комментарий');

    await act(async () => resolveComment?.());
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Комментарий к тренировке') as HTMLTextAreaElement).value)
        .toBe('Исходный комментарий');
    });

    fireEvent.click(commentButton!);
    expect((screen.getByPlaceholderText('Комментарий к тренировке') as HTMLTextAreaElement).value)
      .toBe('Исходный комментарий');
  });
});
