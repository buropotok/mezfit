// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramDetailsPage } from './ProgramDetailsPage';

const details = {
  program: {
    id: 5,
    userId: 7,
    name: 'Силовой цикл',
    status: 'draft' as const,
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
  ownerType: 'client' as const,
  plannedStartDate: null,
  plannedEndDate: null,
  completedExerciseCount: 0,
  exerciseCount: 0,
  progressPercent: 0,
  phases: [{
    id: 12,
    name: 'Базовая фаза',
    position: 0,
    status: 'pending' as const,
    plannedStartDate: null,
    plannedEndDate: null,
    startedAt: null,
    finishedAt: null,
    completedExerciseCount: 0,
    exerciseCount: 0,
    progressPercent: 0,
    exercises: [],
  }],
};

const previewExercise = {
  id: 7,
  scope: 'global' as const,
  name: 'Bench Press',
  description: null,
  tracking_type: 'weight_reps' as const,
  category_code: 'chest' as const,
  equipment_code: 'barbell' as const,
  reference_source: null,
  reference_key: null,
  reference_media_url: null,
  is_favourite: false,
  can_edit: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProgramDetailsPage phase actions', () => {
  it('previews the existing exercise module and deletes a phase after confirmation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/coach/programs/5' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ details }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/coach/exercises?sort=reference' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ exercises: [previewExercise] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/coach/programs/5/phases/12' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({
          details: {
            ...details,
            phases: [],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProgramDetailsPage initData="telegram-init" programId={5} />);

    const addExerciseButton = await screen.findByRole('button', { name: '+ упражнение' });
    fireEvent.click(addExerciseButton);

    expect(await screen.findByRole('heading', { name: 'Добавить упражнение' })).toBeTruthy();
    expect(await screen.findByText('Bench Press')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Опции упражнения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть подход 3' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Добавить упражнение' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const alert = screen.getByRole('alertdialog');
    fireEvent.click(within(alert).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(screen.getByText('Фазы пока не добавлены')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
