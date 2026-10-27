// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cloneElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

let finishClosing: (() => void) | undefined;
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    SortableList: ({ items, header, footer }: React.ComponentProps<typeof actual.SortableList>) =>
      <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
    LiquidPopover: (props: LiquidPopoverProps) => {
      finishClosing = () => props.onPresentationChange?.(false);
      return <>{cloneElement(props.trigger, { onClick: () => props.onOpenChange(!props.isOpen) })}
        {props.isOpen ? <div role="menu">{props.items?.map(item =>
          <button key={item.id} disabled={item.disabled} onClick={item.onSelect}>{item.label}</button>)}
        </div> : null}</>;
    },
  };
});

const session: ActiveWorkoutSession<string> = {
  sessionId: 'session-x', occurrenceId: null, status: 'active', workoutDate: '2026-10-27',
  startedAt: null, completedAt: null, program: null, phase: null, day: null,
  exercises: [{
    sessionExerciseId: 'exercise-x', workoutSessionId: 'session-x', sourceProgramExerciseId: null,
    position: 0, status: 'active', notes: null, sets: [],
    exercise: {
      id: 'definition-x', name: 'Жим лёжа', scope: 'global',
      description: null, tracking_type: 'weight_reps', category_code: 'chest',
      equipment_code: 'barbell', reference_source: null, reference_key: null,
      reference_media_url: null, is_favourite: false, can_edit: false,
    },
  }],
};

afterEach(() => { cleanup(); finishClosing = undefined; });

describe('workout exercise actions', () => {
  it('opens information from exercise media without expanding its sets', () => {
    const information = vi.fn();
    render(<WorkoutSessionCard session={session} onReorderExerciseIds={() => {}}
      onSaveSet={async () => {}} onExerciseInformation={information}
      onDeleteExercise={() => {}} />);
    const disclosure = screen.getByRole('button', { name: 'Развернуть упражнение' });
    fireEvent.click(screen.getByRole('button', { name: 'Информация об упражнении: Жим лёжа' }));
    expect(information).toHaveBeenCalledOnce();
    expect(information).toHaveBeenCalledWith('exercise-x');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  });

  it('uses the planning LiquidPopover for deletion and information after dismissal', () => {
    const remove = vi.fn(), information = vi.fn();
    render(<WorkoutSessionCard session={session} onReorderExerciseIds={() => {}}
      onSaveSet={async () => {}} onDeleteExercise={remove} onExerciseInformation={information} />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(remove).not.toHaveBeenCalled();
    act(() => finishClosing?.());
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('exercise-x');
    fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Информация' }));
    expect(information).not.toHaveBeenCalled();
    act(() => finishClosing?.());
    expect(information).toHaveBeenCalledOnce();
    expect(information).toHaveBeenCalledWith('exercise-x');
  });

  it('keeps information available for a completed session but disables deletion', () => {
    const information = vi.fn();
    render(<WorkoutSessionCard session={{ ...session, status: 'completed' }}
      onReorderExerciseIds={() => {}} onSaveSet={async () => {}}
      onDeleteExercise={() => {}} onExerciseInformation={information} />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
    expect(screen.getByRole('button', { name: 'Удалить' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Информация' }).hasAttribute('disabled')).toBe(false);
  });
});
