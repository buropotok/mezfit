import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { uploadPersonalExerciseMedia } from '../api';
import type { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import { blankPersonalExercise } from '../data/exercises/blankPersonalExercise';
import type { CatalogueExerciseRow, CoachExerciseChanges, CoachExerciseDefinitionRow } from '../data/exercises/coachExerciseTypes';
import { storePersonalExerciseMedia } from '../data/exercises/personalExerciseMediaCache';
import { PUBLIC_EXERCISE_CATEGORIES } from '../data/exercises/publicExerciseFilters';
import { isExerciseTrackingType, type ExerciseTrackingType, type PublicTaxonomyRow } from '../data/exercises/publicExerciseTypes';
import { getTelegramWebApp } from '../telegram';
import { Button, Dropdown, Icon, Text, TextArea, TextInput, type DropdownOption } from '../ui';
import { ExerciseDetail } from './ExerciseCatalogContent';
import './personal-exercises.css';

export type PersonalExerciseEditorRequest =
  | { mode: 'copy'; source: 'public' | 'trainer'; exerciseId: string }
  | { mode: 'create'; category: string | null }
  | { mode: 'edit'; exerciseId: string };

const TRACKING: Array<{ value: ExerciseTrackingType; label: string }> = [
  { value: 'weight_reps', label: 'Вес и повторения' },
  { value: 'time', label: 'Время' },
  { value: 'time_distance', label: 'Время и дистанция' },
  { value: 'time_reps', label: 'Время и повторения' },
  { value: 'time_weight', label: 'Время и вес' },
];
const MUSCLES = [
  ['primary', 'Основные мышцы'],
  ['secondary', 'Вспомогательные мышцы'],
  ['stabilizers', 'Стабилизаторы'],
  ['emphasis', 'Акцент'],
] as const;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Не удалось сохранить упражнение';
}

function textOptions(values: readonly string[], current: string): DropdownOption[] {
  const unique = new Set([...values, current].map(value => value.trim()).filter(Boolean));
  return [
    { value: '', label: 'Не указано' },
    ...[...unique].sort((a, b) => a.localeCompare(b, 'ru'))
      .map(value => ({ value, label: value })),
  ];
}

function Field({ label, value, options, onChange, disabled }: {
  label: string;
  value: string | null;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return <div className="mezfit-personal-exercise-field">
    <Text variant="footnote" tone="muted">{label}</Text>
    <Dropdown mode="single" variant="field" title={label} placeholder="Выбрать"
      triggerProps={{ 'aria-label': label }}
      value={value} options={options} onChange={onChange} disabled={disabled} />
  </div>;
}

function MultiField({ label, value, options, onChange, disabled }: {
  label: string;
  value: string[];
  options: DropdownOption[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  return <div className="mezfit-personal-exercise-field">
    <Text variant="footnote" tone="muted">{label}</Text>
    <Dropdown mode="multi" variant="field" title={label} placeholder="Не указано"
      triggerProps={{ 'aria-label': label }}
      value={value} options={options} onChange={onChange} disabled={disabled} />
  </div>;
}

function EditPersonalExercise({
  request, source, repository, selectedCoachUserId, sourceRows, taxonomy,
  mediaAccountId, onCreated, onClose,
}: {
  request: PersonalExerciseEditorRequest;
  source: CatalogueExerciseRow | null;
  repository: CoachExerciseCatalogueRepository;
  selectedCoachUserId: string | null;
  sourceRows: readonly CatalogueExerciseRow[];
  taxonomy: readonly PublicTaxonomyRow[];
  mediaAccountId: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const initial = useMemo<CatalogueExerciseRow>(() => {
    if (source) return structuredClone(source);
    return {
      ...blankPersonalExercise(request.mode === 'create' ? request.category : null),
      id: 'custom:unsaved', realmId: mediaAccountId,
      owner: mediaAccountId, sourceSha256: 'coach-custom',
    };
  }, [source, request, mediaAccountId]);
  const [draft, setDraft] = useState<CatalogueExerciseRow>(initial);
  const [upload, setUpload] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const stagedImage = useRef<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!upload || typeof URL.createObjectURL !== 'function') {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(upload);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [upload]);

  const scalarFields = useMemo(() => {
    const fields = ['subcategory', 'equipment', 'movement_type', 'body_part', 'target', 'muscle_group'] as const;
    return new Map<string, DropdownOption[]>(fields.map(field => [
      field, textOptions(sourceRows.map(row => row[field]), draft[field]),
    ] as const));
  }, [sourceRows, draft.subcategory, draft.equipment, draft.movement_type,
    draft.body_part, draft.target, draft.muscle_group]);

  const muscleOptions = useMemo<DropdownOption[]>(() => {
    const labels = new Map(taxonomy.map(item => [item.id, item.subcategory_ru]));
    const ids = new Set(taxonomy.map(item => item.id));
    for (const row of sourceRows) {
      for (const values of Object.values(row.muscles)) values.forEach(id => ids.add(id));
      row.mobility_targets.forEach(id => ids.add(id));
      row.secondary_muscles.forEach(id => ids.add(id));
    }
    for (const values of Object.values(draft.muscles)) values.forEach(id => ids.add(id));
    draft.mobility_targets.forEach(id => ids.add(id));
    draft.secondary_muscles.forEach(id => ids.add(id));
    return [...ids].sort((a, b) => (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b, 'ru'))
      .map(id => ({ value: id, label: labels.get(id) ?? id }));
  }, [sourceRows, taxonomy, draft.muscles, draft.mobility_targets, draft.secondary_muscles]);

  const update = <K extends keyof CatalogueExerciseRow>(key: K, value: CatalogueExerciseRow[K]) =>
    setDraft(current => ({ ...current, [key]: value }));
  const updateMuscles = (key: keyof CatalogueExerciseRow['muscles'], value: string[]) =>
    setDraft(current => ({ ...current, muscles: { ...current.muscles, [key]: value } }));

  const save = async () => {
    const name = draft.name_ru.trim();
    if (inFlight.current || !name || name.length > 120) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const changes: CoachExerciseChanges = {
        name: request.mode === 'edit' && draft.name_ru === initial.name_ru ? initial.name : name,
        name_ru: name, name_en: draft.name_en.trim(),
        category: draft.category, subcategory: draft.subcategory,
        subcategory_ru: draft.subcategory_ru, equipment: draft.equipment,
        movement_type: draft.movement_type, tracking_type: draft.tracking_type,
        body_part: draft.body_part, target: draft.target, muscle_group: draft.muscle_group,
        secondary_muscles: draft.secondary_muscles,
        muscles: draft.muscles, mobility_targets: draft.mobility_targets,
        instructions: draft.instructions,
        instruction_steps: draft.instructions.ru !== initial.instructions.ru
          ? { ...draft.instruction_steps, ru: [] } : draft.instruction_steps,
      };
      if (request.mode === 'edit') {
        // Do not overwrite unrelated fields changed by Dexie Cloud while this
        // card was open. Personal edits only persist fields actually modified.
        const fields = [
          'name', 'name_ru', 'name_en', 'category', 'subcategory', 'subcategory_ru',
          'equipment', 'movement_type', 'tracking_type', 'body_part', 'target',
          'muscle_group', 'secondary_muscles', 'muscles', 'mobility_targets',
          'instructions', 'instruction_steps',
        ] as const;
        for (const field of fields) {
          if (JSON.stringify(changes[field]) === JSON.stringify(initial[field])) {
            delete changes[field];
          }
        }
      }
      if (upload) {
        const previous = stagedImage.current;
        const url = previous?.file === upload ? previous.url
          : await uploadPersonalExerciseMedia(getTelegramWebApp()?.initData ?? '', upload);
        stagedImage.current = { file: upload, url };
        await storePersonalExerciseMedia(mediaAccountId, url, upload);
        changes.image = url;
      }
      if (request.mode === 'edit' && Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      const id = request.mode === 'edit'
        ? (await repository.updateExercise(request.exerciseId, changes), request.exerciseId)
        : request.mode === 'create'
          ? await repository.createBlankExercise(request.category, name, changes)
          : request.source === 'public'
            ? await repository.duplicatePublicExercise(request.exerciseId, changes)
            : selectedCoachUserId
              ? await repository.duplicateAssignedCoachExercise(selectedCoachUserId, request.exerciseId, changes)
              : null;
      if (!id) throw new Error('Не выбран тренер');
      if (request.mode === 'edit') onClose();
      else onCreated(id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const categoryOptions = [...PUBLIC_EXERCISE_CATEGORIES].map(([value, label]) => ({ value, label }));
  const subcategories = new Map(sourceRows.filter(row => row.category === draft.category)
    .map(row => [row.subcategory, row.subcategory_ru]));
  if (draft.subcategory) subcategories.set(draft.subcategory, draft.subcategory_ru);
  const subcategoryOptions = [
    { value: '', label: 'Не указано' },
    ...[...subcategories.entries()].filter(([value]) => value).map(([value, label]) =>
      ({ value, label: label || value })),
  ];
  const option = (key: 'subcategory' | 'equipment' | 'movement_type' | 'body_part' | 'target' | 'muscle_group', label: string) =>
    <Field key={key} label={label} value={draft[key] || null} options={
      key === 'subcategory' ? subcategoryOptions : scalarFields.get(key) ?? []
    } disabled={busy} onChange={value => {
      if (key === 'subcategory') {
        setDraft(current => ({ ...current, subcategory: value,
          subcategory_ru: subcategories.get(value) ?? '' }));
      } else update(key, value);
    }} />;

  const editor: {
    name: ReactNode; metadata: ReactNode; instructions: ReactNode;
    anatomy: ReactNode; actions: ReactNode;
  } = {
    actions: <>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
        className="mezfit-personal-exercise-file-input" aria-label="Выбрать изображение"
        disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          if (file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            setError('Поддерживаются GIF, JPG, PNG и WebP до 8 МБ');
            return;
          }
          setUpload(file);
          setError('');
        }} />
      <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
        Загрузить изображение
      </Button>
      <Button disabled={busy || !draft.name_ru.trim()} onClick={() => { void save(); }}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </>,
    name: <div className="mezfit-personal-exercise-fields">
      <TextInput label="Название" value={draft.name_ru} maxLength={120}
        disabled={busy} onChange={event => update('name_ru', event.currentTarget.value)} />
      <TextInput label="Название на английском" value={draft.name_en} maxLength={120}
        disabled={busy} onChange={event => update('name_en', event.currentTarget.value)} />
    </div>,
    metadata: <div className="mezfit-personal-exercise-fields">
      <Field label="Тип учёта" value={draft.tracking_type ?? null}
        options={[{ value: '', label: 'Не указан' }, ...TRACKING]}
        disabled={busy}
        onChange={value => { if (!value || isExerciseTrackingType(value)) update('tracking_type', value || undefined); }} />
      <Field label="Категория" value={draft.category} options={categoryOptions}
        disabled={busy} onChange={value => setDraft(current => current.category === value
          ? current : { ...current, category: value, subcategory: '', subcategory_ru: '' })} />
      {option('subcategory', 'Подкатегория')}
      {option('equipment', 'Оборудование')}
      {option('movement_type', 'Тип движения')}
      {option('body_part', 'Часть тела')}
      {option('target', 'Целевая мышца')}
      {option('muscle_group', 'Группа мышц')}
    </div>,
    instructions: <TextArea label="Инструкция" rows={5} disabled={busy}
      value={draft.instructions.ru}
      onChange={event => update('instructions', { ...draft.instructions, ru: event.currentTarget.value })} />,
    anatomy: <div className="mezfit-personal-exercise-fields">
      {MUSCLES.map(([key, label]) => <MultiField key={key} label={label}
        value={draft.muscles[key]} options={muscleOptions} disabled={busy}
        onChange={values => updateMuscles(key, values)} />)}
      <MultiField label="Цели подвижности" value={draft.mobility_targets}
        options={muscleOptions} disabled={busy}
        onChange={values => update('mobility_targets', values)} />
      <MultiField label="Дополнительные мышцы" value={draft.secondary_muscles}
        options={muscleOptions} disabled={busy}
        onChange={values => update('secondary_muscles', values)} />
    </div>,
  };

  const media = preview ? <img className="mezfit-public-exercises__media-image mezfit-public-exercises__media-image--detail"
    src={preview} alt="Выбранное изображение" /> : request.mode === 'create'
      ? <Icon name="barbell" /> : undefined;

  return <section className="mezfit-personal-exercise-page" aria-label="Редактирование моего упражнения">
    <ExerciseDetail row={draft} taxonomy={[...taxonomy]} origin="personal"
      media={media} mediaAccountId={mediaAccountId} editor={editor} />
    {error ? <Text role="alert" variant="footnote">{error}</Text> : null}
  </section>;
}

/** The source is only a preview. Repository authorization and insertion occur on Save. */
export function PersonalExerciseEditorGateway({
  request, repository, rows, sourceRows = rows, taxonomy = [],
  mediaAccountId = '', selectedCoachUserId, onCreated, onClose,
}: {
  request: PersonalExerciseEditorRequest | null;
  repository: CoachExerciseCatalogueRepository;
  rows: readonly CoachExerciseDefinitionRow[];
  sourceRows?: readonly CatalogueExerciseRow[];
  taxonomy?: readonly PublicTaxonomyRow[];
  mediaAccountId?: string;
  selectedCoachUserId: string | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  if (!request) return null;
  const source = request.mode === 'create' ? null
    : request.mode === 'edit'
      ? rows.find(row => row.id === request.exerciseId && row.archivedAt === null)
      : sourceRows.find(row => row.id === request.exerciseId);
  if (request.mode !== 'create' && !source) return <section role="alert">
    <Text>Это упражнение недоступно.</Text>
    <Button onClick={onClose}>Закрыть</Button>
  </section>;
  return <EditPersonalExercise key={JSON.stringify(request)}
    request={request} source={source ?? null} repository={repository}
    selectedCoachUserId={selectedCoachUserId} sourceRows={sourceRows}
    taxonomy={taxonomy} mediaAccountId={mediaAccountId}
    onCreated={onCreated} onClose={onClose} />;
}
