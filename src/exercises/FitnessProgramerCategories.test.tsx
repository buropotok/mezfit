// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiquidGlassTextOnlyProps } from '../ui/LiquidGlassTextOnly';
import { projectFitnessProgramerExercise } from '../data/exercises/fitnessProgramerCatalogue';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';

vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (action: () => void) => action(),
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, onValueChange }: LiquidGlassTextOnlyProps) =>
    <>{tabs.map(tab => <button key={tab.value} onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</>,
}));
vi.mock('./FitnessProgramerProvider', async importOriginal => ({
  ...await importOriginal<typeof import('./FitnessProgramerProvider')>(),
  useFitnessProgramerCatalogue: () => ({ exercises: [exercise], error: false, downloaded: 0, total: 1 }),
  useLocalFitnessProgramerGif: () => null,
}));

const exercise = projectFitnessProgramerExercise({
  id: 'fitnessprogramer:test', realmId: 'rlm-public', owner: null, release: 'a'.repeat(64),
  categories: ['chest'], gifId: 'fitnessprogramer:gif:' + 'b'.repeat(64),
  card: { name: 'Press', name_ru: 'Жим лёжа', source_url: 'https://fitnessprogramer.com/exercise/test/',
    equipment: [], how_to: '', muscle_group: [], muscles: { target: [] }, tracking_type: 'weight_reps' },
});
const snapshot: Extract<PublicExerciseSnapshot, { status: 'ready' }> = {
  status: 'ready', exercises: [], taxonomy: [],
  catalogue: { id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
    schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    sourceSha256: 'c'.repeat(64), exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-11-18' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens Base 2 categories and selects an exercise before the first GIF is available', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const select = vi.fn();
  render(<KonstaProvider theme="ios" dark>
    <ExerciseCatalogContent snapshot={snapshot} mode="select" onToggleExercise={select} />
  </KonstaProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'База 2' }));
  fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
  fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }));
  expect(select).toHaveBeenCalledWith(exercise.id);
});
