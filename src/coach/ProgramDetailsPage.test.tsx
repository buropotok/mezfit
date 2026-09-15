// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramDetailsPage } from './ProgramDetailsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProgramDetailsPage phase creation', () => {
  it('opens the phase modal from the FAB and appends the canonical created phase', async () => {
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

    const addButton = await screen.findByRole('button', { name: 'Добавить фазу' });
    fireEvent.click(addButton);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Добавить фазу')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Базовая фаза' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByText('Базовая фаза')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
