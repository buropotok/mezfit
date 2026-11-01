// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
  it('shows the UIkit fallback while cloud Blob media is not yet locally synchronized', () => {
    const { container } = render(
      <KonstaProvider theme="ios" dark><ExerciseCatalogContent snapshot={snapshot} /></KonstaProvider>,
    );
    const chest = screen.getByRole('button', { name: /Грудь/ });
    const leading = chest.querySelector('.ui-list-item__leading');
    expect(leading?.classList.contains('ui-list-item__leading--square')).toBe(false);
    expect(chest.querySelector('img')).toBeNull();
    const chestIcon = chest.querySelector('.mezfit-public-exercises__category-fallback > .ui-icon');
    expect(chestIcon).not.toBeNull();
    expect(chestIcon?.getAttribute('style')).toContain('mask-image:');
    expect(container.querySelectorAll('.mezfit-public-exercises__category-fallback img').length).toBe(0);
    // Every category, including Other, uses the shared UIkit barbell while Blob art is unavailable.
    expect(container.querySelectorAll('.mezfit-public-exercises__category-fallback > .ui-icon').length).toBe(9);
    const other = screen.getByRole('button', { name: /Другое/ });
    const otherIcon = other.querySelector('.mezfit-public-exercises__category-fallback > .ui-icon');
    expect(otherIcon?.getAttribute('style')).toBe(chestIcon?.getAttribute('style'));
  });

});
