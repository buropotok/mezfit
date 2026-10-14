// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';

vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (action: () => void) => action(),
}));
vi.mock('./PublicExerciseMedia', () => ({
  PublicExerciseMedia: () => <span aria-hidden="true" />,
}));

const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const example = {
  id: '0001', name: 'Bench press', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: '0001', image: '',
  gif_url: '0001.gif', attribution: '', created_at: '2026-10-01',
  instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
  source_consistency_issue: null, anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  realmId: 'rlm-public' as const, owner: null, sourceSha256: sha,
};

const snapshot = {
  status: 'ready' as const, exercises: [example], taxonomy: [],
  catalogue: {
    id: 'mezfit:exercise-catalogue' as const, realmId: 'rlm-public' as const, owner: null,
    schemaVersion: '2.0.0' as const, catalogue: 'mezfit.exercise_catalog.ru_anatomy' as const,
    sourceSha256: sha, exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-01',
  },
} satisfies Extract<PublicExerciseSnapshot, { status: 'ready' }>;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exercise catalogue real UI composition', () => {
  it('renders the 72px category artwork without the 48px clipped square slot', () => {
    const { container } = render(
      <KonstaProvider theme="ios" dark><ExerciseCatalogContent snapshot={snapshot} /></KonstaProvider>,
    );
    const chest = screen.getByRole('button', { name: /Грудь/ });
    const leading = chest.querySelector('.ui-list-item__leading');
    expect(leading?.classList.contains('ui-list-item__leading--square')).toBe(false);
    const artwork = chest.querySelector('img');
    expect(artwork?.getAttribute('src')).toBe('/gym-keeper/categories/muscles_chest.svg');
    expect(artwork?.getAttribute('width')).toBe('72');
    expect(artwork?.getAttribute('height')).toBe('72');
    expect(container.querySelectorAll('.mezfit-public-exercises__category-fallback img').length).toBe(8);
    const other = screen.getByRole('button', { name: /Другое/ });
    expect(other.querySelector('svg')?.getAttribute('width')).toBe('72');
  });

  it('uses the real Mezfit Searchbar with its sliding cancel control and Tabler filter stroke 1', () => {
    const { container } = render(
      <KonstaProvider theme="ios" dark><ExerciseCatalogContent snapshot={snapshot} /></KonstaProvider>,
    );
    const searchbar = container.querySelector('.k-searchbar');
    expect(searchbar).not.toBeNull();
    expect(container.querySelector('.ui-search-input')).toBeNull();
    const searchInput = screen.getByPlaceholderText('Найти упражнение');
    fireEvent.focus(searchInput);
    const cancel = searchbar?.querySelector<HTMLButtonElement>('button.k-glass');
    expect(cancel).not.toBeNull();
    expect(cancel?.style.marginRight).toBe('0px');
    const filter = screen.getByRole('button', { name: 'Фильтры' });
    expect(filter.querySelector('svg')?.getAttribute('stroke-width')).toBe('1');
    expect(filter.querySelector('svg path')?.getAttribute('d'))
      .toBe('M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227');
  });

  it('marks selected exercise rows visibly without changing browse rows', () => {
    const { container } = render(
      <KonstaProvider theme="ios" dark>
        <ExerciseCatalogContent snapshot={snapshot} mode="select" selectedExerciseIds={new Set(['0001'])} />
      </KonstaProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    const selectedRow = screen.getByRole('button', { name: /Жим лёжа/ });
    expect(selectedRow.getAttribute('aria-pressed')).toBe('true');
    expect(selectedRow.querySelector('.mezfit-public-exercises__selected-dot')).not.toBeNull();
    expect(container.querySelectorAll('.mezfit-public-exercises__selected-dot')).toHaveLength(1);
  });
});
