import { useState } from 'react';
import type { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import type { CoachExerciseDefinitionRow } from '../data/exercises/coachExerciseTypes';
import { Button, MezfitDialog, MezfitDialogButton, Text, TextArea, TextInput } from '../ui';
import './personal-exercises.css';

export type PersonalExerciseEditorRequest =
  | { mode: 'copy'; source: 'public' | 'trainer'; exerciseId: string }
  | { mode: 'create'; category: string | null }
  | { mode: 'edit'; exerciseId: string };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Не удалось сохранить упражнение';
}

function CopyOrCreate({
  request, repository, selectedCoachUserId, onCreated, onClose,
}: {
  request: Extract<PersonalExerciseEditorRequest, { mode: 'copy' | 'create' }>;
  repository: CoachExerciseCatalogueRepository;
  selectedCoachUserId: string | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (busy || (request.mode === 'create' && !name.trim())) return;
    setBusy(true);
    setError('');
    try {
      const id = request.mode === 'create'
        ? await repository.createBlankExercise(request.category, name)
        : request.source === 'public'
          ? await repository.duplicatePublicExercise(request.exerciseId)
          : selectedCoachUserId
            ? await repository.duplicateAssignedCoachExercise(selectedCoachUserId, request.exerciseId)
            : null;
      if (!id) throw new Error('Не выбран тренер');
      onCreated(id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = request.mode === 'copy';
  return (
    <MezfitDialog
      opened
      title={copy ? 'Создать мою копию?' : 'Новое упражнение'}
      content={<div className="mezfit-personal-exercise-editor">
        <Text variant="body">{copy
          ? 'Исходное упражнение останется без изменений. Копия появится в разделе «Мои упражнения» и будет доступна для редактирования.'
          : 'Упражнение сохранится в личном каталоге. Оно будет доступно даже без тренера.'}</Text>
        {!copy ? <TextInput label="Название" value={name} maxLength={120}
          onChange={event => setName(event.currentTarget.value)} /> : null}
        {error ? <Text role="alert" variant="footnote">{error}</Text> : null}
      </div>}
      onBackdropClick={() => { if (!busy) onClose(); }}
      buttons={<>
        <MezfitDialogButton onClick={onClose} disabled={busy}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong disabled={busy || (!copy && !name.trim())}
          onClick={() => { void confirm(); }}>
          {copy ? 'Создать копию' : 'Создать'}
        </MezfitDialogButton>
      </>}
    />
  );
}

function EditPersonalExercise({
  row, repository, onClose,
}: {
  row: CoachExerciseDefinitionRow;
  repository: CoachExerciseCatalogueRepository;
  onClose: () => void;
}) {
  const [nameRu, setNameRu] = useState(row.name_ru);
  const [nameEn, setNameEn] = useState(row.name_en);
  const [equipment, setEquipment] = useState(row.equipment);
  const [instructions, setInstructions] = useState(row.instructions.ru);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (busy || !nameRu.trim()) return;
    setBusy(true);
    setError('');
    try {
      await repository.updateExercise(row.id, {
        name: nameRu.trim(),
        name_ru: nameRu.trim(),
        name_en: nameEn.trim(),
        equipment: equipment.trim(),
        instructions: { ...row.instructions, ru: instructions.trim() },
        instruction_steps: instructions !== row.instructions.ru
          ? { ...row.instruction_steps, ru: [] } : row.instruction_steps,
      });
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mezfit-personal-exercise-page" aria-label="Редактирование моего упражнения">
      <Text variant="headline">Изменить моё упражнение</Text>
      <Text variant="footnote" tone="muted">Пользовательское упражнение</Text>
      <div className="mezfit-personal-exercise-editor">
        <TextInput label="Название" value={nameRu} maxLength={120}
          onChange={event => setNameRu(event.currentTarget.value)} />
        <TextInput label="Название на английском" value={nameEn}
          onChange={event => setNameEn(event.currentTarget.value)} />
        <TextInput label="Оборудование" value={equipment}
          onChange={event => setEquipment(event.currentTarget.value)} />
        <TextArea label="Инструкция" rows={4} value={instructions}
          onChange={event => setInstructions(event.currentTarget.value)} />
        {error ? <Text role="alert" variant="footnote">{error}</Text> : null}
      </div>
      <div className="mezfit-personal-exercise-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Отмена</Button>
        <Button onClick={() => { void save(); }} disabled={busy || !nameRu.trim()}>Сохранить</Button>
      </div>
    </section>
  );
}

/** All mutations run through the personal domain repository, never the D1 editor. */
export function PersonalExerciseEditorGateway({
  request, repository, rows, selectedCoachUserId, onCreated, onClose,
}: {
  request: PersonalExerciseEditorRequest | null;
  repository: CoachExerciseCatalogueRepository;
  rows: readonly CoachExerciseDefinitionRow[];
  selectedCoachUserId: string | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  if (!request) return null;
  if (request.mode === 'create' || request.mode === 'copy') {
    return <CopyOrCreate key={JSON.stringify(request)} request={request}
      repository={repository} selectedCoachUserId={selectedCoachUserId}
      onCreated={onCreated} onClose={onClose} />;
  }
  const row = rows.find(item => item.id === request.exerciseId && item.archivedAt === null);
  if (!row) return <section className="mezfit-personal-exercise-page" role="alert">
    <Text>Это упражнение больше не входит в вашу личную библиотеку.</Text>
    <Button onClick={onClose}>Закрыть</Button>
  </section>;
  return <EditPersonalExercise key={row.id} row={row} repository={repository} onClose={onClose} />;
}
