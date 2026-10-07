// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramDetailsPage } from './ProgramDetailsPage';

const navigationMocks = vi.hoisted(() => ({
  registerSurfaceAction: vi.fn(),
}));

vi.mock('../NavigationShell', () => ({
  useNavigationSurfaceFloatingAction: navigationMocks.registerSurfaceAction,
}));

afterEach(() => {
  cleanup();
  navigationMocks.registerSurfaceAction.mockReset();
  vi.unstubAllGlobals();
});

describe('ProgramDetailsPage phase creation', () => {
  it('opens phase creation only from the FAB popover and appends the canonical created phase', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/coach/programs/5' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({
          details: {
            program: {
              id: 5,
              userId: 7,
              name: 'Силовой цикл',
              status: 'draft',
              startedAt: null,
              finishedAt: null,
            },
            owner: {
              id: 7,
              firstName: 'Анна',
              lastName: 'Иванова',
              username: 'anna',
              photoUrl: null,
            },
            ownerType: 'client',
            plannedStartDate: null,
            plannedEndDate: null,
            completedExerciseCount: 0,
            exerciseCount: 0,
            progressPercent: 0,
            phases: [],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/coach/programs/5/phases' && init?.method === 'POST') {
        expect(init.body).toBe(JSON.stringify({ name: 'Базовая фаза' }));
        return new Response(JSON.stringify({
          phase: {
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
          },
        }), { status: 201, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProgramDetailsPage initData="telegram-init" programId={5} />);

    await waitFor(() => {
      expect(navigationMocks.registerSurfaceAction.mock.calls.some(([action]) => action?.label === 'Добавить')).toBe(true);
    });
    const action = [...navigationMocks.registerSurfaceAction.mock.calls]
      .reverse()
      .map(([registered]) => registered)
      .find((registered) => registered?.label === 'Добавить');
    if (!action) throw new Error('Missing registered program actions');
    expect(action.icon).toBe('plus');
    expect(action.onClick).toBeUndefined();
    expect(action.popoverItems?.map(({ icon, label }: { icon?: string; label: string }) => ({ icon, label }))).toEqual([
      { icon: 'plus', label: 'День' },
      { icon: 'plus', label: 'Фаза' },
    ]);
    expect(screen.queryByRole('heading', { name: 'Добавить фазу' })).toBeNull();

    const day = action.popoverItems?.find(({ id }: { id: string }) => id === 'add-day');
    const phase = action.popoverItems?.find(({ id }: { id: string }) => id === 'add-phase');
    if (!day || !phase) throw new Error('Missing day or phase popover item');
    expect(day.onSelect).toBeUndefined();
    act(() => { day.onSelect?.(); });
    expect(screen.queryByRole('heading', { name: 'Добавить фазу' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { phase.onSelect?.(); });
    expect(screen.getByRole('heading', { name: 'Добавить фазу' })).toBeTruthy();
    expect(screen.getByLabelText('Название')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Базовая фаза' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByText('Базовая фаза')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Добавить фазу' })).toBeNull());
  });
});
