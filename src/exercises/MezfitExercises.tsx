import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { List as KonstaList, ListItem as KonstaListItem } from 'konsta/react';
import type {
  ExerciseCategoryCode,
  ExerciseDefinition,
  ExerciseDefinitionInput,
  ExerciseEquipmentCode,
  TrackingType,
} from '../api';
import {
  EXERCISE_CATEGORY_CODES,
  createExerciseRepository,
  type ExerciseDataset,
} from '../data/exercises/ExerciseRepository';
import { publicMediaCache } from '../data/media/MediaCache';
import { useCachedMediaUrl } from '../data/media/useCachedMediaUrl';
import { ExerciseMedia, exerciseMediaUrl } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import {
  Button,
  Dropdown,
  Icon,
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  MezfitBottomSheet,
  MezfitDialog,
  MezfitDialogButton,
  MezfitSearchbar,
  Modal,
  Surface,
  Text,
  TextArea,
  TextInput,
} from '../ui';
import './mezfit-exercises.css';

export type MezfitExercisesMode = 'manage' | 'select' | 'client-history';

const categoryLabels: Record<ExerciseCategoryCode, string> = {
  chest: 'Грудь',
  arms: 'Руки',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  core: 'Корпус',
  full_body: 'Фулбоди',
  cardio: 'Кардио',
  other: 'Другое',
};

const categoryMediaUrls: Record<ExerciseCategoryCode, string> = {
  chest: '/gym-keeper/categories/muscles_chest.svg',
  arms: '/gym-keeper/categories/muscles_arm.svg',
  back: '/gym-keeper/categories/muscles_back.svg',
  legs: '/gym-keeper/categories/muscles_leg.svg',
  shoulders: '/gym-keeper/categories/muscles_shoulders.svg',
  core: '/gym-keeper/categories/muscles_core.svg',
  full_body: '/gym-keeper/categories/muscles_fullbody.svg',
  cardio: '/gym-keeper/categories/muscles_cardio.svg',
  other: '/gym-keeper/categories/muscles_other.png',
};

const trackingLabels: Record<TrackingType, string> = {
  weight_reps: 'Вес и повторения',
  time: 'Время',
  time_distance: 'Время и дистанция',
  time_reps: 'Время и повторения',
  time_weight: 'Время и вес',
};

const equipmentOptions: Array<{ code: ExerciseEquipmentCode; label: string }> = [
  { code: 'bodyweight', label: 'Свой вес' },
  { code: 'barbell', label: 'Штанга' },
  { code: 'dumbbell_single', label: 'Гантель x1' },
  { code: 'dumbbell_pair', label: 'Гантели x2' },
  { code: 'cable', label: 'Трос' },
  { code: 'machine', label: 'Тренажёр' },
  { code: 'other', label: 'Другое' },
];

const equipmentLabels = Object.fromEntries(
  equipmentOptions.map(({ code, label }) => [code, label]),
) as Record<ExerciseEquipmentCode, string>;

const categoryOptions = EXERCISE_CATEGORY_CODES.map((code) => ({
  code,
  label: categoryLabels[code],
}));

const categoryDropdownOptions = categoryOptions.map(({ code, label }) => ({ value: code, label }));
const equipmentDropdownOptions = equipmentOptions.map(({ code, label }) => ({ value: code, label }));
const trackingDropdownOptions = Object.entries(trackingLabels).map(([value, label]) => ({ value, label }));

const categorySubgroups: Partial<Record<ExerciseCategoryCode, Array<{ code: string; label: string }>>> = {
  chest: [
    { code: 'middle', label: 'Середина' },
    { code: 'upper', label: 'Верх' },
    { code: 'lower', label: 'Низ' },
  ],
  arms: [
    { code: 'biceps', label: 'Бицепс' },
    { code: 'triceps', label: 'Трицепс' },
    { code: 'forearm', label: 'Предплечье' },
  ],
};

function subgroupFor(exercise: ExerciseDefinition): string {
  const source = `${exercise.name} ${exercise.reference_key ?? ''}`.toLocaleLowerCase('en-US');
  if (exercise.category_code === 'chest') {
    if (source.includes('incline')) return 'upper';
    if (source.includes('decline')) return 'lower';
    return 'middle';
  }
  if (exercise.category_code === 'arms') {
    if (source.includes('triceps') || source.includes('pushdown') || source.includes('extension')) {
      return 'triceps';
    }
    if (source.includes('forearm') || source.includes('wrist') || source.includes('reverse curl')) {
      return 'forearm';
    }
    return 'biceps';
  }
  return '';
}

function ExerciseCategoryMedia({
  category,
}: {
  category: ExerciseCategoryCode;
}) {
  const src = useCachedMediaUrl(categoryMediaUrls[category]);
  if (!src) return <Icon name="barbell" />;
  return <img src={src} alt="" className="mezfit-exercises__category-image" decoding="async" />;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
}

function matchesSearch(exercise: ExerciseDefinition, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeSearch([
    exerciseDisplayName(exercise),
    exercise.name,
    exercise.reference_key ?? '',
    exercise.description ?? '',
  ].join(' '));
  return haystack.includes(query);
}

function datasetFor(mode: MezfitExercisesMode, clientUserId?: number): ExerciseDataset {
  if (mode === 'manage') return { kind: 'coach-catalog' };
  if (mode === 'select') return { kind: 'workout' };
  if (!clientUserId) throw new Error('CLIENT_USER_ID_REQUIRED');
  return { kind: 'client-history', clientUserId };
}

interface ExerciseEditorState {
  mode: 'create' | 'edit';
  seed?: ExerciseDefinition;
}

function ExerciseEditor({
  state,
  saving,
  error,
  onCancel,
  onSave,
  onRequestDelete,
}: {
  state: ExerciseEditorState;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (input: ExerciseDefinitionInput) => void;
  onRequestDelete?: () => void;
}) {
  const seed = state.seed;
  const [name, setName] = useState(seed?.name ?? '');
  const [description, setDescription] = useState(seed?.description ?? '');
  const [trackingType, setTrackingType] = useState<TrackingType>(seed?.tracking_type ?? 'weight_reps');
  const [categoryCode, setCategoryCode] = useState<ExerciseCategoryCode>(seed?.category_code ?? 'other');
  const [equipmentCode, setEquipmentCode] = useState<ExerciseEquipmentCode>(seed?.equipment_code ?? 'other');

  const submit = () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    onSave({
      name: cleanName,
      description: description.trim() || undefined,
      trackingType,
      categoryCode,
      equipmentCode,
    });
  };

  return (
    <Modal
      isOpen
      title={state.mode === 'edit' ? 'Редактирование упражнения' : 'Новое упражнение'}
      closeOnBackdrop={!saving}
      onClose={() => {
        if (!saving) onCancel();
      }}
    >
      <div className="mezfit-exercises__editor">
        <Surface className="mezfit-exercises__editor-media">
          {seed ? <ExerciseMedia exercise={seed} variant="editor" /> : <Icon name="barbell" />}
        </Surface>
        <div className="mezfit-exercises__editor-fields">
          <TextInput
            label="Название"
            value={name}
            maxLength={120}
            disabled={saving}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TextArea
            label="Описание"
            value={description}
            maxLength={500}
            disabled={saving}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Dropdown
            mode="single"
            variant="field"
            title="Учёт результата"
            options={trackingDropdownOptions}
            value={trackingType}
            disabled={saving}
            onChange={(value) => setTrackingType(value as TrackingType)}
          />
          <Dropdown
            mode="single"
            variant="field"
            title="Категория"
            options={categoryDropdownOptions}
            value={categoryCode}
            disabled={saving}
            onChange={(value) => setCategoryCode(value as ExerciseCategoryCode)}
          />
          <Dropdown
            mode="single"
            variant="field"
            title="Оборудование"
            options={equipmentDropdownOptions}
            value={equipmentCode}
            disabled={saving}
            onChange={(value) => setEquipmentCode(value as ExerciseEquipmentCode)}
          />
        </div>
      </div>
      {error ? <Text variant="footnote" className="mezfit-exercises__error" role="alert">{error}</Text> : null}
      <div className="mezfit-exercises__editor-actions">
        {state.mode === 'edit' && onRequestDelete ? (
          <Button variant="danger" disabled={saving} onClick={onRequestDelete}>Удалить</Button>
        ) : <span />}
        <div className="mezfit-exercises__editor-save-actions">
          <Button variant="secondary" disabled={saving} onClick={onCancel}>Отмена</Button>
          <Button disabled={saving || !name.trim()} onClick={submit}>
            {saving ? 'Сохраняем…' : state.mode === 'edit' ? 'Сохранить' : 'Добавить'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FilterChip({
  selected,
  disabled,
  children,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mezfit-exercises__filter${selected ? ' mezfit-exercises__filter--selected' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <Text variant="body">{children}</Text>
    </button>
  );
}

export interface MezfitExercisesContentProps {
  initData: string;
  mode: MezfitExercisesMode;
  clientUserId?: number;
  selectedExerciseIds?: ReadonlySet<number>;
  selectionDisabled?: boolean;
  onToggleExercise?: (exerciseDefinitionId: number) => void;
  className?: string;
}

export function MezfitExercisesContent({
  initData,
  mode,
  clientUserId,
  selectedExerciseIds = new Set<number>(),
  selectionDisabled = false,
  onToggleExercise,
  className = '',
}: MezfitExercisesContentProps) {
  const repository = useMemo(() => createExerciseRepository(initData), [initData]);
  const dataset = useMemo(() => datasetFor(mode, clientUserId), [clientUserId, mode]);
  const [exercises, setExercises] = useState<ExerciseDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExerciseCategoryCode | null>(null);
  const [equipmentCode, setEquipmentCode] = useState<ExerciseEquipmentCode | ''>('');
  const [subgroup, setSubgroup] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [selectedInfo, setSelectedInfo] = useState<ExerciseDefinition | null>(null);
  const [menuExercise, setMenuExercise] = useState<ExerciseDefinition | null>(null);
  const [editing, setEditing] = useState<ExerciseEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(normalizeSearch(searchInput)), 120);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setError('');

    const load = async () => {
      let local: ExerciseDefinition[] = [];
      try {
        local = await repository.read(dataset);
        if (cancelled) return;
        setExercises(local);
        setLoading(local.length === 0);
      } catch {
        if (!cancelled) setLoading(true);
      }

      try {
        const fresh = await repository.refresh(dataset);
        if (!cancelled) {
          setExercises(fresh);
          setError('');
        }
      } catch (reason) {
        if (!cancelled && local.length === 0) {
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить упражнения');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [dataset, repository]);

  useEffect(() => {
    void publicMediaCache.prefetch(Object.values(categoryMediaUrls));
    const urls = exercises
      .map(exerciseMediaUrl)
      .filter((url): url is string => Boolean(url));
    void publicMediaCache.prefetch(urls);
  }, [exercises]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ExerciseCategoryCode, number>();
    for (const exercise of exercises) {
      const category = exercise.category_code ?? 'other';
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [exercises]);

  const filteredExercises = useMemo(() => exercises.filter((exercise) => {
    const category = exercise.category_code ?? 'other';
    if (selectedCategory && category !== selectedCategory) return false;
    if (equipmentCode && exercise.equipment_code !== equipmentCode) return false;
    if (favouritesOnly && !exercise.is_favourite) return false;
    if (subgroup && subgroupFor(exercise) !== subgroup) return false;
    return matchesSearch(exercise, search);
  }), [equipmentCode, exercises, favouritesOnly, search, selectedCategory, subgroup]);

  const rootFiltering = selectedCategory === null && Boolean(
    searchInput.trim() || equipmentCode || favouritesOnly,
  );
  const showExerciseList = selectedCategory !== null || rootFiltering;
  const subgroupOptions = selectedCategory ? categorySubgroups[selectedCategory] ?? [] : [];

  const syncLocal = async () => {
    setExercises(await repository.read(dataset));
  };

  const saveEditor = async (input: ExerciseDefinitionInput) => {
    if (!editing || mode !== 'manage') return;
    setSaving(true);
    setEditorError('');
    try {
      let exercise: ExerciseDefinition;
      if (editing.mode === 'edit' && editing.seed?.can_edit) {
        exercise = await repository.update(editing.seed.id, input);
      } else {
        exercise = await repository.create(input);
      }
      await syncLocal();
      setSelectedInfo((current) => current?.id === exercise.id ? exercise : current);
      setEditing(null);
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : 'Не удалось сохранить упражнение');
    } finally {
      setSaving(false);
    }
  };

  const toggleFavourite = async (exercise: ExerciseDefinition) => {
    if (mode !== 'manage' || saving) return;
    setMenuExercise(null);
    setSaving(true);
    setError('');
    try {
      await repository.setFavourite(exercise, !exercise.is_favourite);
      await syncLocal();
      setSelectedInfo((current) => current?.id === exercise.id
        ? { ...current, is_favourite: !exercise.is_favourite }
        : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить избранное');
    } finally {
      setSaving(false);
    }
  };

  const archiveEdited = async () => {
    if (
      mode !== 'manage'
      || editing?.mode !== 'edit'
      || !editing.seed?.can_edit
      || editing.seed.scope !== 'coach'
    ) return;
    setSaving(true);
    setEditorError('');
    try {
      await repository.archive(editing.seed.id);
      await syncLocal();
      setDeleteConfirmOpen(false);
      setEditing(null);
      setSelectedInfo((current) => current?.id === editing.seed?.id ? null : current);
    } catch (reason) {
      setDeleteConfirmOpen(false);
      setEditorError(reason instanceof Error ? reason.message : 'Не удалось удалить упражнение');
    } finally {
      setSaving(false);
    }
  };

  if (selectedInfo) {
    return (
      <section className={`mezfit-exercises ${className}`.trim()}>
        <div className="mezfit-exercises__view-header">
          <IconButton
            label="Назад к упражнениям"
            icon="chevron-left"
            onClick={() => setSelectedInfo(null)}
          />
          <Text variant="title">{exerciseDisplayName(selectedInfo)}</Text>
        </div>
        <div className="mezfit-exercises__detail-media">
          <ExerciseMedia exercise={selectedInfo} variant="detail" decorative={false} />
        </div>
        <Surface className="mezfit-exercises__detail-copy">
          <Text variant="title">{exerciseDisplayName(selectedInfo)}</Text>
          {selectedInfo.description ? <Text variant="body" tone="muted">{selectedInfo.description}</Text> : null}
          <Text variant="footnote" tone="muted">
            {trackingLabels[selectedInfo.tracking_type]}
            {selectedInfo.equipment_code ? ` · ${equipmentLabels[selectedInfo.equipment_code]}` : ''}
          </Text>
          {mode === 'manage' ? (
            <div className="mezfit-exercises__detail-actions">
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void toggleFavourite(selectedInfo)}
              >
                {selectedInfo.is_favourite ? 'Убрать из избранного' : 'В избранное'}
              </Button>
              {selectedInfo.can_edit ? (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setEditorError('');
                    setEditing({ mode: 'edit', seed: selectedInfo });
                  }}
                >
                  Редактировать
                </Button>
              ) : null}
            </div>
          ) : null}
        </Surface>
        {editing ? (
          <ExerciseEditor
            key={`${editing.mode}:${editing.seed?.id ?? 'new'}`}
            state={editing}
            saving={saving}
            error={editorError}
            onCancel={() => setEditing(null)}
            onSave={(input) => void saveEditor(input)}
            onRequestDelete={
              editing.mode === 'edit'
              && editing.seed?.can_edit
              && editing.seed.scope === 'coach'
                ? () => setDeleteConfirmOpen(true)
                : undefined
            }
          />
        ) : null}
        <MezfitDialog
          opened={deleteConfirmOpen}
          title="Удалить упражнение?"
          content="Упражнение исчезнет из каталога. Исторические результаты сохранятся."
          onBackdropClick={() => {
            if (!saving) setDeleteConfirmOpen(false);
          }}
          buttons={
            <>
              <MezfitDialogButton onClick={() => setDeleteConfirmOpen(false)} disabled={saving}>
                Отмена
              </MezfitDialogButton>
              <MezfitDialogButton tone="danger" onClick={() => void archiveEdited()} disabled={saving}>
                Удалить
              </MezfitDialogButton>
            </>
          }
        />
      </section>
    );
  }

  return (
    <section className={`mezfit-exercises ${className}`.trim()} aria-label="Упражнения">
      {selectedCategory ? (
        <div className="mezfit-exercises__view-header">
          <IconButton
            label="Назад к категориям"
            icon="chevron-left"
            disabled={selectionDisabled}
            onClick={() => {
              setSelectedCategory(null);
              setSubgroup('');
              setMenuExercise(null);
            }}
          />
          <Text variant="title">{categoryLabels[selectedCategory]}</Text>
        </div>
      ) : null}

      <div className="mezfit-exercises__search-row">
        <MezfitSearchbar
          value={searchInput}
          placeholder="Поиск упражнения"
          clearButton
          disableButton={false}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          onClear={() => setSearchInput('')}
        />
        {mode === 'manage' ? (
          <Button
            size="compact"
            onClick={() => {
              setEditorError('');
              setEditing({ mode: 'create' });
            }}
          >
            Добавить
          </Button>
        ) : null}
      </div>

      <div className="mezfit-exercises__filters" aria-label="Фильтры упражнений">
        {mode === 'manage' ? (
          <FilterChip
            selected={favouritesOnly}
            disabled={selectionDisabled}
            onClick={() => setFavouritesOnly((value) => !value)}
          >
            Избранное
          </FilterChip>
        ) : null}
        {subgroupOptions.map((option) => (
          <FilterChip
            key={option.code}
            selected={subgroup === option.code}
            disabled={selectionDisabled}
            onClick={() => setSubgroup((value) => value === option.code ? '' : option.code)}
          >
            {option.label}
          </FilterChip>
        ))}
        {equipmentOptions.map((option) => (
          <FilterChip
            key={option.code}
            selected={equipmentCode === option.code}
            disabled={selectionDisabled}
            onClick={() => setEquipmentCode((value) => value === option.code ? '' : option.code)}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>

      {error ? <Text variant="footnote" className="mezfit-exercises__error" role="alert">{error}</Text> : null}

      {loading && exercises.length === 0 ? (
        <Text variant="body" tone="muted">Загружаем упражнения…</Text>
      ) : !showExerciseList ? (
        <KonstaList dividers className="mezfit-exercises__category-list" aria-label="Категории упражнений">
          {categoryOptions.map((category) => (
              <KonstaListItem
                key={category.code}
                media={(
                  <span className="mezfit-exercises__category-media">
                    <ExerciseCategoryMedia category={category.code} />
                  </span>
                )}
                title={<Text variant="title">{category.label}</Text>}
                after={<Text variant="footnote" tone="muted">{categoryCounts.get(category.code) ?? 0}</Text>}
                link
                linkComponent="button"
                linkProps={{
                  type: 'button',
                  'aria-label': category.label,
                  onClick: () => {
                    setSelectedCategory(category.code);
                    setSubgroup('');
                    setMenuExercise(null);
                  },
                }}
              />
          ))}
        </KonstaList>
      ) : filteredExercises.length === 0 ? (
        <div className="mezfit-exercises__empty">
          <Text variant="headline">Ничего не найдено</Text>
          <Text variant="body" tone="muted">Измените поиск или фильтры.</Text>
        </div>
      ) : (
        <List divider="inset" className="mezfit-exercises__list">
          {filteredExercises.map((exercise) => {
            const selected = selectedExerciseIds.has(exercise.id);
            const rowProps = mode === 'select'
              ? {
                  'aria-pressed': selected,
                  disabled: selectionDisabled,
                  onClick: () => onToggleExercise?.(exercise.id),
                }
              : {
                  onClick: () => setSelectedInfo(exercise),
                };
            return (
              <ListItem
                key={exercise.id}
                leadingShape="square"
                leading={<ExerciseMedia exercise={exercise} />}
                title={exerciseDisplayName(exercise)}
                subtitle={[
                  trackingLabels[exercise.tracking_type],
                  exercise.equipment_code ? equipmentLabels[exercise.equipment_code] : null,
                ].filter(Boolean).join(' · ')}
                trailing={mode === 'select' && selected ? <Icon name="check" /> : undefined}
                trailingAction={mode === 'manage' ? (
                  <Menu
                    isOpen={menuExercise?.id === exercise.id}
                    onOpenChange={(open) => setMenuExercise(open ? exercise : null)}
                    align="end"
                    label={`Действия: ${exerciseDisplayName(exercise)}`}
                    trigger={(
                      <IconButton
                        label={`Действия: ${exerciseDisplayName(exercise)}`}
                        icon="dots-vertical"
                        disabled={saving}
                      />
                    )}
                  >
                    <MenuItem onSelect={() => {
                      setMenuExercise(null);
                      setSelectedInfo(exercise);
                    }}>Информация</MenuItem>
                    <MenuItem onSelect={() => void toggleFavourite(exercise)}>
                      {exercise.is_favourite ? 'Убрать из избранного' : 'Добавить в избранное'}
                    </MenuItem>
                    <MenuItem onSelect={() => {
                      setMenuExercise(null);
                      setEditorError('');
                      setEditing({
                        mode: 'create',
                        seed: { ...exercise, name: `${exerciseDisplayName(exercise)} — копия`, can_edit: false },
                      });
                    }}>Дублировать</MenuItem>
                    {exercise.can_edit ? (
                      <MenuItem onSelect={() => {
                        setMenuExercise(null);
                        setEditorError('');
                        setEditing({ mode: 'edit', seed: exercise });
                      }}>Редактировать</MenuItem>
                    ) : null}
                  </Menu>
                ) : undefined}
                {...rowProps}
              />
            );
          })}
        </List>
      )}

      {editing ? (
        <ExerciseEditor
          key={`${editing.mode}:${editing.seed?.id ?? 'new'}:${editing.seed?.name ?? ''}`}
          state={editing}
          saving={saving}
          error={editorError}
          onCancel={() => setEditing(null)}
          onSave={(input) => void saveEditor(input)}
          onRequestDelete={editing.mode === 'edit' && editing.seed?.can_edit
            ? () => setDeleteConfirmOpen(true)
            : undefined}
        />
      ) : null}

      <MezfitDialog
        opened={deleteConfirmOpen}
        title="Удалить упражнение?"
        content="Упражнение исчезнет из каталога. Исторические результаты сохранятся."
        onBackdropClick={() => {
          if (!saving) setDeleteConfirmOpen(false);
        }}
        buttons={
          <>
            <MezfitDialogButton onClick={() => setDeleteConfirmOpen(false)} disabled={saving}>
              Отмена
            </MezfitDialogButton>
            <MezfitDialogButton tone="danger" onClick={() => void archiveEdited()} disabled={saving}>
              Удалить
            </MezfitDialogButton>
          </>
        }
      />
    </section>
  );
}

export type MezfitExercisesSheetProps = MezfitExercisesContentProps & {
  opened: boolean;
  onClose: () => void;
  title?: string;
  footer?: ReactNode;
  notice?: ReactNode;
};

export function MezfitExercisesSheet({
  opened,
  onClose,
  title = 'Упражнения',
  footer,
  notice,
  ...contentProps
}: MezfitExercisesSheetProps) {
  return (
    <MezfitBottomSheet opened={opened} label={title} contentClassName="mezfit-exercises-sheet">
      <div className="mezfit-exercises-sheet__header">
        <Text variant="headline">{title}</Text>
        <IconButton label="Закрыть" icon="x" onClick={onClose} />
      </div>
      {notice ? <div className="mezfit-exercises-sheet__notice">{notice}</div> : null}
      <MezfitExercisesContent {...contentProps} />
      {footer ? <div className="mezfit-exercises-sheet__footer">{footer}</div> : null}
    </MezfitBottomSheet>
  );
}

export function ClientExercises({
  initData,
  clientUserId,
}: {
  initData: string;
  clientUserId: number;
}) {
  return (
    <MezfitExercisesContent
      initData={initData}
      mode="client-history"
      clientUserId={clientUserId}
    />
  );
}
