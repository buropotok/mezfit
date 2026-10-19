// @vitest-environment jsdom
import type { ChangeEvent, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import type { CatalogueExerciseRow, CoachExerciseChanges, CoachExerciseDefinitionRow } from '../data/exercises/coachExerciseTypes';
import { PersonalExerciseEditorGateway } from './PersonalExerciseEditorGateway';

vi.mock('../telegram', () => ({ getTelegramWebApp: () => ({ initData: 'signed-init' }) }));
vi.mock('../api', () => ({
  uploadPersonalExerciseMedia: vi.fn(async () =>
    '/api/exercise-media/personal/11111111-1111-4111-8111-111111111111?v=' + 'a'.repeat(64)),
}));
vi.mock('../data/exercises/personalExerciseMediaCache', () => ({
  storePersonalExerciseMedia: vi.fn(async () => undefined),
}));
vi.mock('./ExerciseCatalogContent', () => ({
  ExerciseDetail: ({ editor, media }: {
    editor: { name: ReactNode; metadata: ReactNode; instructions: ReactNode;
      anatomy: ReactNode; actions: ReactNode };
    media?: ReactNode;
  }) => <section aria-label="Карточка упражнения">
    {media}{editor.actions}{editor.name}{editor.metadata}{editor.instructions}{editor.anatomy}
  </section>,
}));
vi.mock('../ui', () => ({
  Button: ({ children, onClick, disabled }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Icon: () => <span>barbell</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextInput: ({ label, value, onChange }: {
    label: string; value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  }) => <input aria-label={label} value={value} onChange={onChange} />,
  TextArea: ({ label, value, onChange }: {
    label: string; value: string; onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  }) => <textarea aria-label={label} value={value} onChange={onChange} />,
  Dropdown: ({ mode, triggerProps, value, options, onChange }: {
    mode: 'single' | 'multi'; triggerProps?: { 'aria-label'?: string };
    value: string | null | string[]; options: { value: string; label: string }[];
    onChange: (value: string | string[]) => void;
  }) => <select aria-label={triggerProps?.['aria-label']}
    multiple={mode === 'multi'}
    value={mode === 'multi' ? value as string[] : value as string ?? ''}
    onChange={event => mode === 'multi'
      ? onChange(Array.from(event.currentTarget.selectedOptions).map(option => option.value))
      : onChange(event.currentTarget.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));
const customId = 'custom:11111111-1111-4111-8111-111111111111';
const own: CoachExerciseDefinitionRow = {
  id: customId, realmId: 'tg:202', owner: 'tg:202', sourceSha256: 'coach-custom',
  updatedAt: '2026-10-15', archivedAt: null,
  name: 'Мой жим', name_ru: 'Мой жим', name_en: '', category: 'chest',
  subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance',
  tracking_type: 'weight_reps',
  muscles: { primary: ['pectoralis_major'], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
  secondary_muscles: [], media_id: '', image: '', gif_url: '', attribution: '',
  created_at: '2026-10-15', instructions: { ru: 'Инструкция', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};
const publicRow: CatalogueExerciseRow = { ...own, id: '0001', realmId: 'rlm-public',
  owner: null, sourceSha256: 'a'.repeat(64), name_ru: 'Жим из базы' };
const api = () => ({
  duplicatePublicExercise: vi.fn(async () => customId),
  duplicateAssignedCoachExercise: vi.fn(async () => customId),
  createBlankExercise: vi.fn(async () => customId),
  updateExercise: vi.fn(async (_id: string, _changes: CoachExerciseChanges,
    _baseline?: Pick<CoachExerciseDefinitionRow, 'muscles' | 'instructions' | 'instruction_steps'>) => undefined),
});
const props = (repository: ReturnType<typeof api>) => ({
  repository: repository as unknown as CoachExerciseCatalogueRepository,
  rows: [own], sourceRows: [own, publicRow],
  mediaAccountId: 'tg:202', selectedCoachUserId: null as string | null,
  onCreated: vi.fn(), onClose: vi.fn(),
});

afterEach(cleanup);

describe('personal exercise card editor', () => {
  it('opens a public copy as an editable card and only writes after Save', async () => {
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'copy', source: 'public', exerciseId: '0001' }} {...p} />);
    expect(screen.getByRole('region', { name: 'Карточка упражнения' })).toBeTruthy();
    expect(screen.getByDisplayValue('Жим из базы')).toBeTruthy();
    expect(repository.duplicatePublicExercise).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }),
      { target: { value: 'Мой жим из базы' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.duplicatePublicExercise).toHaveBeenCalledWith(
      '0001', expect.objectContaining({ name_ru: 'Мой жим из базы' })));
    expect(p.onCreated).toHaveBeenCalledWith(customId);
    expect(repository.updateExercise).not.toHaveBeenCalled();
  });

  it('does not create a record when a new editor is dismissed', () => {
    const repository = api(), p = props(repository);
    const { unmount } = render(<PersonalExerciseEditorGateway
      request={{ mode: 'create', category: 'legs' }} {...p} />);
    expect(screen.getByText('barbell')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(true);
    unmount();
    expect(repository.createBlankExercise).not.toHaveBeenCalled();
  });

  it('creates a blank exercise with the selected tracking and muscle groups on Save', async () => {
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'create', category: 'legs' }}
      taxonomy={[{ id: 'pectoralis_major', subcategory_ru: 'Грудная мышца',
        category_ru: '', anatomical_description_ru: '', kind: 'muscle',
        parent_id: null, owner: null, realmId: 'rlm-public', sourceSha256: 'a'.repeat(64) }]}
      {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }),
      { target: { value: 'Присед' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Тип учёта' }),
      { target: { value: 'time_reps' } });
    fireEvent.change(screen.getByRole('listbox', { name: 'Акцент' }),
      { target: { value: 'pectoralis_major' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.createBlankExercise).toHaveBeenCalledWith(
      'legs', 'Присед', expect.objectContaining({
        tracking_type: 'time_reps', muscles: expect.objectContaining({
          emphasis: ['pectoralis_major'],
        }),
      })));
  });

  it('uploads a selected image, caches it locally, then saves its R2 reference', async () => {
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }} {...p} />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'exercise.png',
      { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Выбрать изображение'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const { uploadPersonalExerciseMedia } = await import('../api');
    const { storePersonalExerciseMedia } = await import('../data/exercises/personalExerciseMediaCache');
    await waitFor(() => expect(uploadPersonalExerciseMedia).toHaveBeenCalledWith('signed-init', file, expect.any(AbortSignal)));
    await waitFor(() => expect(storePersonalExerciseMedia).toHaveBeenCalledWith(
      'tg:202', expect.stringContaining('/api/exercise-media/personal/'), file));
    await waitFor(() => expect(repository.updateExercise).toHaveBeenCalledWith(
      customId, expect.objectContaining({
        image: expect.stringContaining('/api/exercise-media/personal/'),
      }), expect.anything()));
  });

  it('keeps a new draft editable if image upload fails, without creating an exercise', async () => {
    const { uploadPersonalExerciseMedia } = await import('../api');
    vi.mocked(uploadPersonalExerciseMedia).mockRejectedValueOnce(new Error('R2 недоступен'));
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'create', category: 'chest' }} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }),
      { target: { value: 'Упражнение' } });
    fireEvent.change(screen.getByLabelText('Выбрать изображение'), {
      target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'test.png',
        { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText('R2 недоступен')).toBeTruthy());
    expect(repository.createBlankExercise).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveProperty('value', 'Упражнение');
  });

  it('keeps the original edit baseline when cloud sync updates the row while the card is open', async () => {
    const repository = api(), p = props(repository);
    const view = render(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), {
      target: { value: 'Название пользователя' },
    });
    const newer = { ...own, name_ru: 'Название с другого устройства',
      tracking_type: 'time_reps' as const };
    view.rerender(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }} {...p} rows={[newer]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.updateExercise).toHaveBeenCalledWith(
      customId, expect.objectContaining({ name_ru: 'Название пользователя' }),
      expect.objectContaining({ tracking_type: 'weight_reps' }),
    ));
    const changes = repository.updateExercise.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.hasOwn(changes, 'tracking_type')).toBe(false);
  });

  it('continues to save after a noncritical local image-cache write failure', async () => {
    const { storePersonalExerciseMedia } = await import('../data/exercises/personalExerciseMediaCache');
    vi.mocked(storePersonalExerciseMedia).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }} {...p} />);
    fireEvent.change(screen.getByLabelText('Выбрать изображение'), {
      target: { files: [new File(['image'], 'sample.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.updateExercise).toHaveBeenCalledWith(
      customId, expect.objectContaining({ image: expect.stringContaining('/api/exercise-media/personal/') }),
      expect.anything(),
    ));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
  });

  it('cancels pending upload when the editor is dismissed and never creates a ghost exercise', async () => {
    const { uploadPersonalExerciseMedia } = await import('../api');
    let finishUpload: ((url: string) => void) | undefined;
    vi.mocked(uploadPersonalExerciseMedia).mockImplementationOnce(() => new Promise(resolve => {
      finishUpload = resolve;
    }));
    const repository = api(), p = props(repository);
    const view = render(<PersonalExerciseEditorGateway
      request={{ mode: 'create', category: 'chest' }} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), {
      target: { value: 'Несохранённое упражнение' },
    });
    fireEvent.change(screen.getByLabelText('Выбрать изображение'), {
      target: { files: [new File(['image'], 'sample.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(uploadPersonalExerciseMedia).toHaveBeenCalledOnce());
    const signal = vi.mocked(uploadPersonalExerciseMedia).mock.calls.at(-1)?.[2];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    finishUpload?.('/api/exercise-media/personal/11111111-1111-4111-8111-111111111111?v=' + 'a'.repeat(64));
    await Promise.resolve();
    await Promise.resolve();
    expect(repository.createBlankExercise).not.toHaveBeenCalled();
    expect(p.onCreated).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('copies the authorized trainer snapshot only after Save', async () => {
    const repository = api(), p = props(repository);
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'copy', source: 'trainer', exerciseId: customId }}
      {...p} selectedCoachUserId="tg:101" />);
    expect(repository.duplicateAssignedCoachExercise).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.duplicateAssignedCoachExercise)
      .toHaveBeenCalledWith('tg:101', customId, expect.objectContaining({ name_ru: 'Мой жим' })));
    expect(repository.updateExercise).not.toHaveBeenCalled();
  });

  it('allows retrying an existing edit when persistence fails', async () => {
    const repository = api(), p = props(repository);
    repository.updateExercise.mockRejectedValueOnce(new Error('Локальное сохранение не удалось'));
    render(<PersonalExerciseEditorGateway
      request={{ mode: 'edit', exerciseId: customId }} {...p} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название' }),
      { target: { value: 'Название после ошибки' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText('Локальное сохранение не удалось')).toBeTruthy());
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repository.updateExercise).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledOnce());
  });
});
