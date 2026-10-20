// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueExerciseRow } from '../data/exercises/coachExerciseTypes';
import { ExerciseDetail } from './ExerciseCatalogContent';

vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('konsta/react', () => ({
  Checkbox: () => null,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (action: () => void) => action(),
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: () => null,
}));
vi.mock('./CoachExerciseCatalogFab', () => ({
  CoachExerciseCatalogFab: () => null,
}));
vi.mock('../ui/GlassSurface', () => ({
  GlassSurface: ({ children, className, contentClassName }: { children: ReactNode; className?: string; contentClassName?: string }) => (
    <div className={className}><div className={contentClassName}>{children}</div></div>
  ),
}));
vi.mock('./PublicExerciseMedia', () => ({
  PublicExerciseMedia: () => <span aria-hidden="true">GIF</span>,
}));
vi.mock('../workout/WorkedMuscles', () => ({
  WorkedMuscles: () => null,
}));

const publicExercise: CatalogueExerciseRow = {
  id: '0001', realmId: 'rlm-public', owner: null,
  sourceSha256: '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c',
  name: 'Bench press', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', tracking_type: 'weight_reps',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest',
  target: 'chest', muscle_group: 'chest', secondary_muscles: [],
  media_id: '0001', image: '', gif_url: '0001.gif', attribution: '',
  created_at: '2026-10-17', instructions: { ru: '', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};

afterEach(cleanup);

describe('localized metadata on shared exercise detail cards', () => {
  it('shows the synchronized weight/reps value rather than guessing from category', () => {
    render(<ExerciseDetail row={publicExercise} taxonomy={[]} />);
    expect(screen.getByText('Тип учёта: Вес и повторения')).toBeTruthy();
  });

  it('shows the cardio value supplied by the public exercise row', () => {
    render(<ExerciseDetail row={{
      ...publicExercise, id: '0002', tracking_type: 'time_distance',
      // The category is intentionally unchanged: the UI reads the field, not a heuristic.
    }} taxonomy={[]} />);
    expect(screen.getByText('Тип учёта: Время и дистанция')).toBeTruthy();
  });

  it('omits a missing metric without silently defaulting to weight/reps', () => {
    render(<ExerciseDetail row={{ ...publicExercise, tracking_type: undefined }} taxonomy={[]} />);
    expect(screen.queryByText(/Тип учёта:/)).toBeNull();
  });

  it('keeps square media an explicit opt-in for exercise detail', () => {
    const { container, rerender } = render(<ExerciseDetail row={publicExercise} taxonomy={[]} />);
    expect(container.querySelector('.mezfit-public-exercises__media-placeholder--square')).toBeNull();

    rerender(<ExerciseDetail row={publicExercise} taxonomy={[]} mediaLayout="square" />);
    expect(container.querySelector('.mezfit-public-exercises__media-placeholder--square')).not.toBeNull();
    expect(container.querySelector('.mezfit-public-exercises__media-content--square')).not.toBeNull();
  });

  it('shows the same Russian tracking type for a private exercise', () => {
    render(<ExerciseDetail row={{
      ...publicExercise, id: 'custom:example', realmId: 'tg:1234', owner: 'tg:1234',
      sourceSha256: 'coach-custom',
    }} taxonomy={[]} origin="personal" />);
    expect(screen.getByText('Тип учёта: Вес и повторения')).toBeTruthy();
  });
  it('shows equipment and movement in Russian without leaking technical IDs', () => {
    render(<ExerciseDetail row={publicExercise} taxonomy={[]} />);
    expect(screen.getByText('Категория: Грудь')).toBeTruthy();
    expect(screen.getByText('Оборудование: Штанга')).toBeTruthy();
    expect(screen.getByText('Тип движения: Силовые')).toBeTruthy();
    expect(screen.queryByText(/barbell|resistance|weight_reps/)).toBeNull();
  });
});
