// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import { PersonalExercises } from './PersonalExercises';

vi.mock('./usePublishedExerciseCatalogue', () => {
  const db = {};
  const cloud = { db, actorUserId: 'tg:42', status: 'ready' };
  const snapshot = { status: 'ready', exercises: [], taxonomy: [], catalogue: {} };
  return { usePublishedExerciseCatalogue: () => ({ cloud, snapshot, error: '' }) };
});

vi.mock('../data/exercises/coachExerciseCatalogue', () => ({
  CoachExerciseCatalogueRepository: class {
    observe(onChange: (value: {
      overrides: never[];
      definitions: never[];
      favourites: never[];
    }) => void) {
      onChange({ overrides: [], definitions: [], favourites: [] });
      return { unsubscribe: () => undefined };
    }
  },
}));

vi.mock('./ExerciseCatalogContent', async () => {
  const { useEffect } = await import('react');
  return {
    ExerciseCatalogContent: ({
      onCreateExercise, onEditExercise, onNavigationContextChange,
    }: {
      onCreateExercise: (category: string | null) => void;
      onEditExercise: (id: string) => void;
      onNavigationContextChange: (context: NavigationContext | null) => void;
    }) => {
      useEffect(() => {
        onNavigationContextChange({
          title: 'Детали упражнения',
          scrollKey: 'exercise:0001',
          onBack: () => undefined,
        });
        return () => onNavigationContextChange(null);
      }, [onNavigationContextChange]);
      return <div>
        <button onClick={() => onCreateExercise(null)}>Новое</button>
        <button onClick={() => onEditExercise('0001')}>Копировать</button>
      </div>;
    },
  };
});
vi.mock('./PersonalExerciseEditorGateway', () => ({
  PersonalExerciseEditorGateway: ({ request }: { request: { mode: string } | null }) =>
    request ? <div data-testid="exercise-modal">{request.mode}</div> : null,
}));
vi.mock('../ui', () => ({
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

afterEach(cleanup);

describe('personal exercise dialog navigation ownership', () => {
  it('uses the dialog as the active Back target and restores the catalogue detail after dismissal', async () => {
    const setNavigation = vi.fn<(context: NavigationContext | null) => void>();
    render(<PersonalExercises role="coach" onNavigationContextChange={setNavigation} />);

    await waitFor(() => expect(setNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Детали упражнения' })));

    fireEvent.click(screen.getByRole('button', { name: 'Новое' }));
    await waitFor(() => expect(setNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Новое упражнение' })));
    expect(screen.getByTestId('exercise-modal').textContent).toBe('create');

    act(() => {
      const context = setNavigation.mock.lastCall?.[0];
      context?.onBack?.();
    });
    await waitFor(() => expect(setNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Детали упражнения' })));

    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    await waitFor(() => expect(setNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Создать мою копию' })));
    expect(screen.getByTestId('exercise-modal').textContent).toBe('copy');

    act(() => {
      const context = setNavigation.mock.lastCall?.[0];
      context?.onBack?.();
    });
    await waitFor(() => expect(setNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Детали упражнения' })));
  });
});
