import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { uploadPersonalExerciseMedia } from '../api';
import type { CoachExerciseCatalogueRepository } from '../data/exercises/coachExerciseCatalogue';
import { blankPersonalExercise } from '../data/exercises/blankPersonalExercise';
import type { CatalogueExerciseRow, CoachExerciseChanges, CoachExerciseDefinitionRow } from '../data/exercises/coachExerciseTypes';
import { storePersonalExerciseMedia } from '../data/exercises/personalExerciseMediaCache';
import {
  editorFieldOptions, TRACKING_TYPE_LABELS,
  type FilterOption,
} from '../data/exercises/publicExerciseFilters';
import { isExerciseTrackingType, type PublicTaxonomyRow } from '../data/exercises/publicExerciseTypes';
import { getTelegramWebApp } from '../telegram';
import { Button, Icon, Text, TextArea, TextInput } from '../ui';
import { MultiExerciseAttributePicker, SingleExerciseAttributePicker } from './ExerciseAttributePicker';
import { ExerciseDetail } from './ExerciseCatalogContent';
import './personal-exercises.css';

export type PersonalExerciseEditorRequest =
  | { mode: 'copy'; source: 'public' | 'trainer'; exerciseId: string }
  | { mode: 'create'; category: string | null }
  | { mode: 'edit'; exerciseId: string };

const MUSCLES = [
  ['primary', 'Основные мышцы'],
  ['secondary', 'Вспомогательные мышцы'],
  ['stabilizers', 'Стабилизаторы'],
  ['emphasis', 'Акцент'],
] as const;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Не удалось сохранить упражнение';
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
  const [initial] = useState<CatalogueExerciseRow>(() => {
    if (source) return structuredClone(source);
    return {
      ...blankPersonalExercise(request.mode === 'create' ? request.category : null),
      id: 'custom:unsaved', realmId: mediaAccountId,
      owner: mediaAccountId, sourceSha256: 'coach-custom',
    };
  });
  const [draft, setDraft] = useState<CatalogueExerciseRow>(initial);
  const [upload, setUpload] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const saveController = useRef(new AbortController());
  useEffect(() => {
    // React StrictMode may clean up and remount effects without recreating refs.
    if (saveController.current.signal.aborted) saveController.current = new AbortController();
    return () => saveController.current.abort();
  }, []);
  const isActive = () => !saveController.current.signal.aborted;
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

  // Editor options are always calculated from the complete catalogue, NEVER
  // from filter facets or category-specific matches.
  const categoryOptions = useMemo(() => editorFieldOptions('category', sourceRows, taxonomy),
    [sourceRows, taxonomy]);
  const equipmentOptions = useMemo(() => editorFieldOptions('equipment', sourceRows, taxonomy, [draft.equipment]),
    [sourceRows, taxonomy, draft.equipment]);
  const movementOptions = useMemo(() => editorFieldOptions('movement_type', sourceRows, taxonomy, [draft.movement_type]),
    [sourceRows, taxonomy, draft.movement_type]);
  const muscleOptions = useMemo(() => editorFieldOptions('muscle', sourceRows, taxonomy, [
    ...draft.muscles.primary, ...draft.muscles.secondary,
    ...draft.muscles.stabilizers, ...draft.muscles.emphasis, ...draft.mobility_targets,
  ]), [sourceRows, taxonomy, draft.muscles, draft.mobility_targets]);
  const trackingOptions: FilterOption[] = Object.entries(TRACKING_TYPE_LABELS)
    .map(([id, label]) => ({ id, label }));

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
          : await uploadPersonalExerciseMedia(
            getTelegramWebApp()?.initData ?? '', upload, saveController.current.signal,
          );
        if (!isActive()) return;
        stagedImage.current = { file: upload, url };
        // R2 is durable; a full or unavailable WebView IndexedDB cache must
        // not block saving the reference or trigger repeated uploads.
        try { await storePersonalExerciseMedia(mediaAccountId, url, upload); } catch { /* optional cache */ }
        if (!isActive()) return;
        changes.image = url;
      }
      if (request.mode === 'edit' && Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      if (!isActive()) return;
      const id = request.mode === 'edit'
        ? (await repository.updateExercise(request.exerciseId, changes, initial), request.exerciseId)
        : request.mode === 'create'
          ? await repository.createBlankExercise(request.category, name, changes)
          : request.source === 'public'
            ? await repository.duplicatePublicExercise(request.exerciseId, changes)
            : selectedCoachUserId
              ? await repository.duplicateAssignedCoachExercise(selectedCoachUserId, request.exerciseId, changes)
              : null;
      if (!id) throw new Error('Не выбран тренер');
      if (!isActive()) return;
      if (request.mode === 'edit') onClose();
      else onCreated(id);
    } catch (cause) {
      if (isActive()) setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      if (isActive()) setBusy(false);
    }
  };

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
    </div>,
    metadata: <div className="mezfit-personal-exercise-fields">
      <SingleExerciseAttributePicker label="Категория" value={draft.category} options={categoryOptions}
        disabled={busy} onChange={value => update('category', value)} />
      <SingleExerciseAttributePicker label="Оборудование" value={draft.equipment} options={equipmentOptions}
        disabled={busy} onChange={value => update('equipment', value)} />
      <SingleExerciseAttributePicker label="Тип движения" value={draft.movement_type} options={movementOptions}
        disabled={busy} onChange={value => update('movement_type', value)} />
      <SingleExerciseAttributePicker label="Тип учёта" value={draft.tracking_type}
        options={trackingOptions} disabled={busy}
        onChange={value => {
          if (!value) update('tracking_type', undefined);
          else if (isExerciseTrackingType(value)) update('tracking_type', value);
        }} />
    </div>,
    instructions: <TextArea label="Инструкция" rows={5} disabled={busy}
      value={draft.instructions.ru}
      onChange={event => update('instructions', { ...draft.instructions, ru: event.currentTarget.value })} />,
    anatomy: <div className="mezfit-personal-exercise-fields">
      {MUSCLES.map(([key, label]) => <MultiExerciseAttributePicker key={key}
        label={label} value={draft.muscles[key]} options={muscleOptions} disabled={busy}
        onChange={values => updateMuscles(key, values)} />)}
      <MultiExerciseAttributePicker label="Цели подвижности" value={draft.mobility_targets}
        options={muscleOptions} disabled={busy}
        onChange={values => update('mobility_targets', values)} />
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
