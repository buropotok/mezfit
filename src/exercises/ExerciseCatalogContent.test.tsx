// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';

vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (action: () => void) => action(),
}));

vi.mock('../ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  IconButton: ({ children, label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => <button aria-label={label} {...props}>{children}</button>,
  List: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, subtitle, leading, leadingShape, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: React.ReactNode; subtitle?: React.ReactNode; leading?: React.ReactNode; leadingShape?: string }) => <button {...props}>{leading}{title}{subtitle}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Surface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MezfitSearchbar: ({ value, onChange, onDisable }: { value: string; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void; onDisable: () => void }) => <><input aria-label="Найти упражнение" value={value} onChange={onChange} /><button onClick={onDisable}>Закрыть поиск</button></>,
  LiquidPopover: ({ trigger }: { trigger: React.ReactNode }) => <div>{trigger}</div>,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
}));

vi.mock('konsta/react', () => ({
  Checkbox: () => null,
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('./PublicExerciseMedia', () => ({
  PublicExerciseMedia: () => <span aria-hidden="true">GIF</span>,
}));

const sourceSha256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const row = {
  id: '0001', name: 'Bench press', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: '0001', image: '',
  gif_url: '0001.gif', attribution: '', created_at: '2026-10-01',
  instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
  source_consistency_issue: null, anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  realmId: 'rlm-public' as const, owner: null, sourceSha256,
};

const snapshot = {
  status: 'ready' as const, exercises: [row], taxonomy: [],
  catalogue: { id: 'mezfit:exercise-catalogue' as const, realmId: 'rlm-public' as const, owner: null,
    schemaVersion: '2.0.0' as const, catalogue: 'mezfit.exercise_catalog.ru_anatomy' as const,
    sourceSha256, exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-01' },
} satisfies Extract<PublicExerciseSnapshot, { status: 'ready' }>;

afterEach(cleanup);

describe('shared public exercise catalogue', () => {
  it('keeps the existing read-only navigation to details', () => {
    render(<ExerciseCatalogContent snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }));
    expect(screen.getByText('Инструкция')).toBeTruthy();
  });

  it('supports canonical string-ID multi-select without taking ownership of selection', () => {
    const toggle = vi.fn();
    const selected = new Set(['0001']);
    render(<ExerciseCatalogContent snapshot={snapshot} mode="select"
      selectedExerciseIds={selected} onToggleExercise={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    const exercise = screen.getByRole('button', { name: /Жим лёжа/ });
    expect(exercise.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(exercise);
    expect(toggle).toHaveBeenCalledWith('0001');
    expect(exercise.getAttribute('aria-pressed')).toBe('true');
  });

  it('disables selection during saving', () => {
    render(<ExerciseCatalogContent snapshot={snapshot} mode="select" selectionDisabled
      selectedExerciseIds={new Set()} onToggleExercise={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    expect((screen.getByRole('button', { name: /Жим лёжа/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
