// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ChangeEvent, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';
import type { CatalogueExerciseRow } from '../data/exercises/coachExerciseTypes';
import { ExerciseCatalogContent } from './ExerciseCatalogContent';

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
  }) => <div><button disabled={disabled} onClick={onClick} {...props}>{leading}{title}{subtitle}</button>{trailingAction}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MezfitSearchbar: ({ value, onChange }: { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) =>
    <input aria-label="Найти упражнение" value={value} onChange={onChange} />,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <div>{trigger}</div>,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
}));
vi.mock('konsta/react', () => ({
  Checkbox: () => null,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { label: string; value: string }[]; value: string; onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map(tab =>
    <button role="tab" aria-selected={tab.value === value} key={tab.value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>,
  )}</div>,
}));
vi.mock('../ui/GlassSurface', () => ({
  GlassSurface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./CoachExerciseCatalogFab', () => ({
  CoachExerciseCatalogFab: () => null,
}));
vi.mock('./PublicExerciseMedia', () => ({
  PublicExerciseMedia: () => <span>Media</span>,
}));

const publicRow: CatalogueExerciseRow = {
  id: '0001', name: 'Public', name_ru: 'Общий жим', name_en: '',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
  secondary_muscles: [], media_id: '0001', image: '', gif_url: '', attribution: '',
  created_at: '2026-10-15', instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
  source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  realmId: 'rlm-public', owner: null, sourceSha256: '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c',
};
const mine = { ...publicRow, id: 'custom:11111111-1111-4111-8111-111111111111',
  name: 'Mine', name_ru: 'Моё движение', owner: 'tg:202', realmId: 'tg:202', sourceSha256: 'coach-custom' };
const trainer = { ...publicRow, id: 'custom:22222222-2222-4222-8222-222222222222',
  name: 'Trainer', name_ru: 'Авторское тренера', owner: null, realmId: 'rlm-selected',
  sourceSha256: 'assigned-coach-snapshot' };
const snapshot: Extract<PublicExerciseSnapshot, { status: 'ready' }> = {
  status: 'ready', exercises: [publicRow as typeof publicRow & { realmId: 'rlm-public'; owner: null }],
  taxonomy: [],
  catalogue: {
    id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
    schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    sourceSha256: publicRow.sourceSha256, exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-15',
  },
};

afterEach(cleanup);

describe('separate personal and selected trainer tabs', () => {
  it('does not expose a trainer tab in coach mode', () => {
    render(<ExerciseCatalogContent snapshot={snapshot} scope="coach"
      catalogueExercises={[publicRow, mine]} personalIds={new Set([mine.id])} />);
    expect(screen.queryByRole('tab', { name: 'Тренерские' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Мои упражнения' })).toBeTruthy();
  });

  it('only shows selected coach assignments in the client trainer tab', () => {
    const onEdit = vi.fn();
    render(<ExerciseCatalogContent snapshot={snapshot} scope="client"
      catalogueExercises={[publicRow, mine, trainer]}
      personalIds={new Set([mine.id])} assignedIds={new Set([trainer.id])}
      selectedCoachUserId="tg:101" onEditExercise={onEdit} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Тренерские' }));
    expect(screen.getByText('Авторское тренера')).toBeTruthy();
    expect(screen.queryByText('Моё движение')).toBeNull();
    expect(screen.queryByText('Общий жим')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Авторское тренера/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(onEdit).toHaveBeenCalledWith(trainer.id);
  });

  it('keeps custom copies in Mine and public exercises in All Database', () => {
    render(<ExerciseCatalogContent snapshot={snapshot} scope="client"
      catalogueExercises={[publicRow, mine, trainer]}
      personalIds={new Set([mine.id])} assignedIds={new Set([trainer.id])} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Мои упражнения' }));
    expect(screen.getByText('Моё движение')).toBeTruthy();
    expect(screen.queryByText('Авторское тренера')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Вся база' }));
    fireEvent.click(screen.getByRole('button', { name: /Грудь/ }));
    expect(screen.getByText('Общий жим')).toBeTruthy();
    expect(screen.queryByText('Моё движение')).toBeNull();
  });
});
