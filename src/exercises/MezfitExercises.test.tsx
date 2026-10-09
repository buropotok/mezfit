// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseDefinition } from '../api';
import { MezfitExercisesContent } from './MezfitExercises';

const chestExercise: ExerciseDefinition = {
  id: 11,
  scope: 'global',
  name: 'Жим лёжа',
  description: 'Базовый жим',
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: null,
  reference_key: 'bench-press',
  reference_media_url: null,
  is_favourite: false,
  can_edit: false,
};

const backExercise: ExerciseDefinition = {
  ...chestExercise,
  id: 22,
  name: 'Тяга верхнего блока',
  category_code: 'back',
  equipment_code: 'cable',
  reference_key: 'lat-pulldown',
};

const armExercise: ExerciseDefinition = {
  ...chestExercise,
  id: 33,
  name: 'Сгибание рук',
  category_code: 'arms',
  equipment_code: 'dumbbell_pair',
  reference_key: 'biceps-curl',
};

const read = vi.fn();
const refresh = vi.fn();
const create = vi.fn();
const update = vi.fn();
const setFavourite = vi.fn();
const archive = vi.fn();

vi.mock('../data/exercises/ExerciseRepository', () => ({
  EXERCISE_CATEGORY_CODES: [
    'chest',
    'arms',
    'back',
    'legs',
    'shoulders',
    'core',
    'full_body',
    'cardio',
    'other',
  ],
  createExerciseRepository: () => ({
    read,
    refresh,
    create,
    update,
    setFavourite,
    archive,
  }),
}));

vi.mock('../ExerciseMedia', () => ({
  ExerciseMedia: ({ exercise }: { exercise: ExerciseDefinition }) => (
    <span data-testid={`media-${exercise.id}`} />
  ),
  exerciseMediaUrl: () => null,
}));

function renderCatalog() {
  return render(
    <KonstaProvider theme="ios" dark>
      <MezfitExercisesContent initData="init-data" mode="select" />
    </KonstaProvider>,
  );
}

beforeEach(() => {
  const exercises = [chestExercise, backExercise, armExercise];
  read.mockReset().mockResolvedValue(exercises);
  refresh.mockReset().mockResolvedValue(exercises);
  create.mockReset();
  update.mockReset();
  setFavourite.mockReset();
  archive.mockReset();
});

afterEach(cleanup);

describe('MezfitExercisesContent', () => {
  it('replaces root categories with a global debounced search result', async () => {
    renderCatalog();

    expect(await screen.findByRole('button', { name: 'Грудь' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Спина' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Поиск упражнения'), {
      target: { value: 'Тяга' },
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Грудь' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Тяга верхнего блока' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Жим лёжа' })).toBeNull();
  });

  it('keeps search scoped to the selected category', async () => {
    renderCatalog();

    fireEvent.click(await screen.findByRole('button', { name: 'Грудь' }));
    fireEvent.change(screen.getByPlaceholderText('Поиск упражнения'), {
      target: { value: 'Тяга' },
    });

    await waitFor(() => {
      expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Тяга верхнего блока' })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Поиск упражнения'), {
      target: { value: 'Жим' },
    });
    expect(await screen.findByRole('button', { name: 'Жим лёжа' })).toBeTruthy();
  });

  it('uses a root filter across all categories', async () => {
    renderCatalog();

    fireEvent.click(await screen.findByRole('button', { name: 'Трос' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Грудь' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Тяга верхнего блока' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Жим лёжа' })).toBeNull();
  });
});
