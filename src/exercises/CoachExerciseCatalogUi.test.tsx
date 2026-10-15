// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ChangeEvent, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';

vi.mock('../NavigationShell', () => ({
  useNavigationBackTransition: () => (action: () => void) => action(),
}));

vi.mock('../ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  IconButton: ({ children, label, selected, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; selected?: boolean }) =>
    <button aria-label={label} data-selected={selected} {...props}>{children}</button>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, subtitle, leading, trailingAction, onClick, disabled, ...props }: {
    title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailingAction?: ReactNode;
    onClick?: () => void; disabled?: boolean;
  }) => <div><button onClick={onClick} disabled={disabled} {...props}>{leading}{title}{subtitle}</button>{trailingAction}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MezfitSearchbar: ({ value, onChange }: { value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) =>
    <input aria-label="Найти упражнение" value={value} onChange={onChange} />,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <div>{trigger}</div>,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
}));
vi.mock('konsta/react', () => ({
  Checkbox: () => null,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../ui/GlassSurface', () => ({
  GlassSurface: ({ children, optics, preset }: { children: ReactNode; optics: boolean; preset: string }) =>
    <div data-testid="glass-section" data-optics={String(optics)} data-preset={preset}>{children}</div>,
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { label: string; value: string }[]; value: string; onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map(tab =>
    <button role="tab" aria-selected={tab.value === value} key={tab.value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>,
  )}</div>,
}));
vi.mock('./CoachExerciseCatalogFab', () => ({
  CoachExerciseCatalogFab: ({ onCreate }: { onCreate: () => void }) =>
    <button onClick={onCreate}>FAB создать упражнение</button>,
}));
vi.mock('./PublicExerciseMedia', () => ({ PublicExerciseMedia: () => <span>GIF</span> }));

const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const exercise = {
  id: '0001', name: 'Bench press', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: '0001', image: '',
  gif_url: '0001.gif', attribution: '', created_at: '2026-10-01',
  instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
  source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  realmId: 'rlm-public' as const, owner: null, sourceSha256: sha,
};
const snapshot = {
  status: 'ready' as const, exercises: [exercise], taxonomy: [],
  catalogue: { id: 'mezfit:exercise-catalogue' as const, realmId: 'rlm-public' as const, owner: null,
    schemaVersion: '2.0.0' as const, catalogue: 'mezfit.exercise_catalog.ru_anatomy' as const,
    sourceSha256: sha, exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-01' },
} satisfies Extract<PublicExerciseSnapshot, { status: 'ready' }>;

afterEach(cleanup);

describe('coach exercise catalogue UI', () => {
  it('uses existing root/category FAB entry with the selected category context', () => {
    const create = vi.fn();
    render(<ExerciseCatalogContent snapshot={snapshot} scope="coach" onCreateExercise={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'FAB создать упражнение' }));
    expect(create).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    fireEvent.click(screen.getByRole('button', { name: 'FAB создать упражнение' }));
    expect(create).toHaveBeenLastCalledWith('chest');
  });

  it('shows primary placeholder and only favourites within the favourites tab', () => {
    render(<ExerciseCatalogContent snapshot={snapshot} scope="coach" favouriteIds={new Set()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Основные' }));
    expect(screen.getByText('Раздел «Основные» будет доступен позже.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Избранное' }));
    expect(screen.getByText('В избранном пока нет упражнений.')).toBeTruthy();
  });

  it('keeps the Tabler star independent of opening the exercise detail', () => {
    const toggle = vi.fn();
    render(<ExerciseCatalogContent snapshot={snapshot} scope="coach" onToggleFavourite={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в избранное' }));
    expect(toggle).toHaveBeenCalledWith('0001');
    expect(screen.queryByText('Инструкция')).toBeNull();
  });

  it('opens the edit gateway for selected exercise and uses modalTuned without optics', () => {
    const edit = vi.fn();
    render(<ExerciseCatalogContent snapshot={snapshot} scope="coach" onEditExercise={edit} />);
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(edit).toHaveBeenCalledWith('0001');
    const glasses = screen.getAllByTestId('glass-section');
    expect(glasses).toHaveLength(3);
    for (const surface of glasses) {
      expect(surface.getAttribute('data-optics')).toBe('false');
      expect(surface.getAttribute('data-preset')).toBe('modalTuned');
    }
  });
});
