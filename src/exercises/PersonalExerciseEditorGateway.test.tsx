// @vitest-environment jsdom
import type { ChangeEvent, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import type { CoachExerciseDefinitionRow } from '../data/exercises/coachExerciseTypes';
import { PersonalExerciseEditorGateway } from './PersonalExerciseEditorGateway';

vi.mock('../ui', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  MezfitDialog: ({ opened, title, content, buttons }: {
    opened: boolean; title: ReactNode; content: ReactNode; buttons: ReactNode;
  }) => opened ? <section role="dialog" aria-label="editor">{title}{content}{buttons}</section> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextInput: ({ label, value, onChange }: {
    label: string; value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  }) => <input aria-label={label} value={value} onChange={onChange} />,
  TextArea: ({ label, value, onChange }: {
    label: string; value: string; onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  }) => <textarea aria-label={label} value={value} onChange={onChange} />,
}));
const customId = 'custom:11111111-1111-4111-8111-111111111111';
const own: CoachExerciseDefinitionRow = {
  id: customId, realmId: 'tg:202', owner: 'tg:202', sourceSha256: 'coach-custom',
  updatedAt: '2026-10-15', archivedAt: null,
  name: 'Мой жим', name_ru: 'Мой жим', name_en: '', category: 'chest',
  subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
  secondary_muscles: [], media_id: '', image: '', gif_url: '', attribution: '',
  created_at: '2026-10-15', instructions: { ru: 'Инструкция', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};

const api = () => ({
  duplicatePublicExercise: vi.fn(async () => customId),
  duplicateAssignedCoachExercise: vi.fn(async () => customId),
  createBlankExercise: vi.fn(async () => customId),
  updateExercise: vi.fn(async () => undefined),
});

afterEach(cleanup);

describe('personal exercise edit/copy gateway', () => {
  it('confirms a personal copy of an immutable public exercise before writing', async () => {
    const repository = api(), created = vi.fn();
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'copy', source: 'public', exerciseId: '0001' }}
      repository={repository as unknown as CoachExerciseCatalogueRepository}
      rows={[own]} selectedCoachUserId={null} onCreated={created} onClose={vi.fn()} />);
    expect(screen.getByText('Создать мою копию?')).toBeTruthy();
    expect(repository.duplicatePublicExercise).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать копию' }));
    await waitFor(() => expect(repository.duplicatePublicExercise).toHaveBeenCalledExactlyOnceWith('0001'));
    await waitFor(() => expect(created).toHaveBeenCalledWith(customId));
    expect(repository.updateExercise).not.toHaveBeenCalled();
  });

  it('copies only the selected trainer assignment and does not edit the coach record', async () => {
    const repository = api();
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'copy', source: 'trainer', exerciseId: customId }}
      repository={repository as unknown as CoachExerciseCatalogueRepository}
      rows={[]} selectedCoachUserId="tg:101" onCreated={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать копию' }));
    await waitFor(() => expect(repository.duplicateAssignedCoachExercise)
      .toHaveBeenCalledExactlyOnceWith('tg:101', customId));
    expect(repository.updateExercise).not.toHaveBeenCalled();
  });

  it('opens editing immediately for own exercise without a copy confirmation', async () => {
    const repository = api(), close = vi.fn();
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }}
      repository={repository as unknown as CoachExerciseCatalogueRepository}
      rows={[own]} selectedCoachUserId={null} onCreated={vi.fn()} onClose={close} />);
    expect(screen.getByText('Изменить моё упражнение')).toBeTruthy();
    expect(screen.queryByText('Создать мою копию?')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), { target: { value: 'Новое название' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.updateExercise)
      .toHaveBeenCalledWith(customId, expect.objectContaining({ name_ru: 'Новое название' })));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('creates an independent personal exercise without any coach', async () => {
    const repository = api(), created = vi.fn();
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'create', category: 'legs' }}
      repository={repository as unknown as CoachExerciseCatalogueRepository}
      rows={[]} selectedCoachUserId={null} onCreated={created} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), { target: { value: 'Присед' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(repository.createBlankExercise).toHaveBeenCalledWith('legs', 'Присед'));
    await waitFor(() => expect(created).toHaveBeenCalledWith(customId));
  });
});
