import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  archiveCoachExercise,
  createCoachExercise,
  getCoachExercise,
  getCoachExercises,
  setCoachExerciseFavourite,
  updateCoachExercise,
  type ExerciseCategoryCode,
  type ExerciseDefinition,
  type ExerciseEquipmentCode,
  type ExerciseSort,
  type TrackingType,
} from '../api';
import type { NavigationContext } from '../NavigationShell';
import { gymKeeperIcons } from '../gymKeeperIcons';
import { exerciseActionIcons, type ExerciseActionIcon } from './exerciseActionIcons';

const trackingLabels: Record<TrackingType, string> = {
  weight_reps: 'Вес × повторы',
  time: 'Время',
  time_distance: 'Время + дистанция',
  time_reps: 'Время + повторы',
  time_weight: 'Время + вес',
};

const categoryOptions: Array<{ code: ExerciseCategoryCode; label: string }> = [
  { code: 'chest', label: 'Грудь' },
  { code: 'arms', label: 'Руки' },
  { code: 'back', label: 'Спина' },
  { code: 'legs', label: 'Ноги' },
  { code: 'shoulders', label: 'Плечи' },
  { code: 'core', label: 'Корпус' },
  { code: 'full_body', label: 'Фулбоди' },
  { code: 'cardio', label: 'Кардио' },
  { code: 'other', label: 'Другое' },
];

const equipmentOptions: Array<{ code: ExerciseEquipmentCode; label: string }> = [
  { code: 'bodyweight', label: 'Свой вес' },
  { code: 'barbell', label: 'Штанга' },
  { code: 'dumbbell_single', label: 'Гантель x1' },
  { code: 'dumbbell_pair', label: 'Гантели x2' },
  { code: 'cable', label: 'Трос' },
  { code: 'machine', label: 'Тренажер' },
  { code: 'other', label: 'Другое' },
];

const categoryLabels = Object.fromEntries(categoryOptions.map(({ code, label }) => [code, label])) as Record<ExerciseCategoryCode, string>;
const equipmentLabels = Object.fromEntries(equipmentOptions.map(({ code, label }) => [code, label])) as Record<ExerciseEquipmentCode, string>;

function iconStyle(url: string): CSSProperties {
  return { '--exercise-action-icon': url } as CSSProperties;
}

function ActionIcon({ icon }: { icon: ExerciseActionIcon }) {
  return <span className="exercise-action-icon" style={iconStyle(exerciseActionIcons[icon])} aria-hidden="true" />;
}

function ExerciseIcon() {
  return <span className="exercise-action-icon exercise-media-icon" style={iconStyle(gymKeeperIcons.exercises)} aria-hidden="true" />;
}

interface ExerciseInput {
  name: string;
  description?: string;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
}

interface EditorProps {
  exercise?: ExerciseDefinition;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (input: ExerciseInput) => void;
}

function ExerciseEditorDialog({ exercise, saving, error, onCancel, onSave }: EditorProps) {
  const [name, setName] = useState(exercise?.name ?? '');
  const [description, setDescription] = useState(exercise?.description ?? '');
  const [trackingType, setTrackingType] = useState<TrackingType>(exercise?.tracking_type ?? 'weight_reps');
  const [categoryCode, setCategoryCode] = useState<ExerciseCategoryCode>(exercise?.category_code ?? 'other');
  const [equipmentCode, setEquipmentCode] = useState<ExerciseEquipmentCode>(exercise?.equipment_code ?? 'other');

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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onCancel();
    }}>
      <section className="modal-dialog global-exercise-editor" role="dialog" aria-modal="true" aria-labelledby="global-exercise-editor-title">
        <header className="global-exercise-editor-header">
          <div>
            <div className="eyebrow">Упражнение</div>
            <h2 id="global-exercise-editor-title">{exercise ? 'Редактировать' : 'Новое упражнение'}</h2>
          </div>
        </header>

        <div className="global-exercise-editor-top">
          <div className="global-exercise-media-slot" aria-label="Медиа упражнения">
            <ExerciseIcon />
            <small>Медиа</small>
          </div>
          <div className="global-exercise-editor-copy">
            <label className="compact-field-label">Название
              <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
            </label>
            <label className="compact-field-label">Описание
              <textarea className="text-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} />
            </label>
          </div>
        </div>

        <label className="field-label">Учёт результата
          <select className="text-input" value={trackingType} onChange={(event) => setTrackingType(event.target.value as TrackingType)}>
            {Object.entries(trackingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="field-label">Категория
          <select className="text-input" value={categoryCode} onChange={(event) => setCategoryCode(event.target.value as ExerciseCategoryCode)}>
            {categoryOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>

        <div className="field-label">
          <span>Оборудование</span>
          <div className="chip-group" role="radiogroup" aria-label="Оборудование">
            {equipmentOptions.map((option) => (
              <button
                key={option.code}
                type="button"
                className={`selection-chip ${equipmentCode === option.code ? 'selected' : ''}`}
                role="radio"
                aria-checked={equipmentCode === option.code}
                onClick={() => setEquipmentCode(option.code)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-label">
          <span>Доступность</span>
          <div className="global-exercise-scope-note">Всем моим клиентам</div>
        </div>

        {error ? <p className="inline-message error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onCancel} disabled={saving}>Отмена</button>
          <button className="positive-button" type="button" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Сохраняем…' : exercise ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </section>
    </div>
  );
}

interface DetailProps {
  exercise: ExerciseDefinition;
  busy: boolean;
  onFavourite: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function ExerciseDetail({ exercise, busy, onFavourite, onEdit, onArchive }: DetailProps) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  return (
    <section className="global-exercise-detail stack">
      <div className="global-exercise-detail-media">
        <ExerciseIcon />
        <span>Демонстрация упражнения</span>
      </div>

      <section className="global-exercise-info-card">
        <div className="global-exercise-detail-title-row">
          <div>
            <div className="eyebrow">{exercise.scope === 'global' ? 'База Gym Keeper' : 'Моё упражнение'}</div>
            <h2>{exercise.name}</h2>
          </div>
          <button className={`exercise-square-button ${exercise.is_favourite ? 'active' : ''}`} type="button" onClick={onFavourite} disabled={busy} aria-label={exercise.is_favourite ? 'Убрать из избранного' : 'Добавить в избранное'}>
            <ActionIcon icon={exercise.is_favourite ? 'favourite' : 'favouriteEmpty'} />
          </button>
        </div>
        {exercise.description ? <p className="global-exercise-description">{exercise.description}</p> : null}
        <dl className="global-exercise-metadata">
          <div><dt>Учёт результата</dt><dd>{trackingLabels[exercise.tracking_type]}</dd></div>
          <div><dt>Категория</dt><dd>{exercise.category_code ? categoryLabels[exercise.category_code] : 'Не указана'}</dd></div>
          <div><dt>Оборудование</dt><dd>{exercise.equipment_code ? equipmentLabels[exercise.equipment_code] : 'Не указано'}</dd></div>
        </dl>
      </section>

      {exercise.can_edit ? (
        <section className="global-exercise-detail-actions">
          <button type="button" className="global-exercise-action-row" onClick={onEdit} disabled={busy}>
            <ActionIcon icon="edit" /><span>Редактировать упражнение</span>
          </button>
          {confirmArchive ? (
            <div className="global-exercise-delete-confirm">
              <p>Убрать упражнение из каталога? Исторические записи останутся сохранены.</p>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => setConfirmArchive(false)} disabled={busy}>Отмена</button>
                <button className="danger-button" type="button" onClick={onArchive} disabled={busy}>{busy ? 'Удаляем…' : 'Убрать'}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="global-exercise-action-row danger" onClick={() => setConfirmArchive(true)} disabled={busy}>
              <ActionIcon icon="delete" /><span>Удалить из каталога</span>
            </button>
          )}
        </section>
      ) : (
        <p className="global-exercise-readonly-note">Базовое упражнение доступно всем тренерам и не редактируется в личном каталоге.</p>
      )}
    </section>
  );
}

interface Props {
  initData: string;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function GlobalExerciseCatalog({ initData, onNavigationContextChange }: Props) {
  const [search, setSearch] = useState('');
  const [categoryCode, setCategoryCode] = useState<ExerciseCategoryCode | ''>('');
  const [trackingType, setTrackingType] = useState<TrackingType | ''>('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [sort, setSort] = useState<ExerciseSort>('alphabetical');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [selected, setSelected] = useState<ExerciseDefinition | null>(null);
  const [editing, setEditing] = useState<ExerciseDefinition | 'new' | null>(null);
  const [error, setError] = useState('');
  const [editorError, setEditorError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const filters = useMemo(() => ({ search, categoryCode, trackingType, favouritesOnly, sort }), [search, categoryCode, trackingType, favouritesOnly, sort]);

  const load = useCallback(async () => {
    try {
      const result = await getCoachExercises(initData, filters);
      setExercises(result.exercises);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить каталог');
    }
  }, [filters, initData]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      load().catch(() => undefined);
    }, 160);
    return () => {
      cancelled = true;
      void cancelled;
      window.clearTimeout(timer);
    };
  }, [load, reloadToken]);

  useEffect(() => {
    if (!selected) {
      onNavigationContextChange(null);
      return;
    }
    onNavigationContextChange({ title: selected.name, onBack: () => setSelected(null) });
    return () => onNavigationContextChange(null);
  }, [onNavigationContextChange, selected]);

  const openExercise = async (exercise: ExerciseDefinition) => {
    setSelected(exercise);
    setError('');
    try {
      const full = await getCoachExercise(initData, exercise.id);
      setSelected(full.exercise);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть упражнение');
    }
  };

  const toggleFavourite = async (exercise: ExerciseDefinition) => {
    const next = !exercise.is_favourite;
    setBusy(true);
    try {
      await setCoachExerciseFavourite(initData, exercise.id, next);
      setExercises((current) => current?.map((item) => item.id === exercise.id ? { ...item, is_favourite: next } : item) ?? current);
      setSelected((current) => current?.id === exercise.id ? { ...current, is_favourite: next } : current);
      if (favouritesOnly && !next) setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить избранное');
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = async (input: ExerciseInput) => {
    setBusy(true);
    setEditorError('');
    try {
      if (editing === 'new') {
        const result = await createCoachExercise(initData, input);
        setEditing(null);
        setReloadToken((value) => value + 1);
        setSelected(result.exercise);
      } else if (editing) {
        const result = await updateCoachExercise(initData, editing.id, input);
        setEditing(null);
        setReloadToken((value) => value + 1);
        setSelected(result.exercise);
      }
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : 'Не удалось сохранить упражнение');
    } finally {
      setBusy(false);
    }
  };

  const archiveSelected = async () => {
    if (!selected?.can_edit) return;
    setBusy(true);
    try {
      await archiveCoachExercise(initData, selected.id);
      setSelected(null);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось убрать упражнение');
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <>
        <ExerciseDetail
          exercise={selected}
          busy={busy}
          onFavourite={() => void toggleFavourite(selected)}
          onEdit={() => { setEditorError(''); setEditing(selected); }}
          onArchive={() => void archiveSelected()}
        />
        {editing && editing !== 'new' ? (
          <ExerciseEditorDialog exercise={editing} saving={busy} error={editorError} onCancel={() => setEditing(null)} onSave={(input) => void saveEditor(input)} />
        ) : null}
      </>
    );
  }

  const hasActiveFilters = Boolean(search || categoryCode || trackingType || favouritesOnly);

  return (
    <section className="global-exercise-catalog stack">
      <div className="global-exercise-search-row">
        <label className="global-exercise-search">
          <ActionIcon icon="search" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск упражнения" aria-label="Поиск упражнения" />
        </label>
        <button className="exercise-square-button primary" type="button" onClick={() => { setEditorError(''); setEditing('new'); }} aria-label="Добавить упражнение">
          <ActionIcon icon="add" />
        </button>
      </div>

      <div className="global-exercise-filter-row" aria-label="Фильтры каталога">
        <label className="global-exercise-select-wrap">
          <ActionIcon icon="filter" />
          <select value={categoryCode} onChange={(event) => setCategoryCode(event.target.value as ExerciseCategoryCode | '')} aria-label="Категория">
            <option value="">Все категории</option>
            {categoryOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
        <select className="global-exercise-filter-select" value={trackingType} onChange={(event) => setTrackingType(event.target.value as TrackingType | '')} aria-label="Тип учёта результата">
          <option value="">Все типы</option>
          {Object.entries(trackingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className={`exercise-square-button ${favouritesOnly ? 'active' : ''}`} type="button" onClick={() => setFavouritesOnly((value) => !value)} aria-pressed={favouritesOnly} aria-label="Только избранные">
          <ActionIcon icon={favouritesOnly ? 'favourite' : 'favouriteEmpty'} />
        </button>
        <button className={`exercise-square-button ${sort === 'reference' ? 'active' : ''}`} type="button" onClick={() => setSort((value) => value === 'alphabetical' ? 'reference' : 'alphabetical')} aria-label={sort === 'alphabetical' ? 'Сортировка: по алфавиту' : 'Сортировка: порядок каталога'}>
          <ActionIcon icon="sort" />
        </button>
      </div>

      {error ? <p className="inline-message error-text">{error}</p> : null}

      <section className="global-exercise-list-surface" aria-live="polite">
        {exercises === null ? (
          <p className="global-exercise-status">Загружаем упражнения…</p>
        ) : exercises.length === 0 ? (
          <div className="global-exercise-empty">
            <strong>{hasActiveFilters ? 'Ничего не найдено' : 'Каталог пока пуст'}</strong>
            <p>{hasActiveFilters ? 'Измените поиск или фильтры.' : 'Добавьте своё первое упражнение.'}</p>
          </div>
        ) : (
          <div className="global-exercise-list" role="list">
            {exercises.map((exercise) => (
              <div className="global-exercise-row" key={exercise.id} role="listitem">
                <button className="global-exercise-row-main" type="button" onClick={() => void openExercise(exercise)}>
                  <span className={`category-accent category-${exercise.category_code ?? 'other'}`} aria-hidden="true" />
                  <span className="global-exercise-row-copy">
                    <strong>{exercise.name}</strong>
                    <small>
                      {exercise.category_code ? categoryLabels[exercise.category_code] : 'Без категории'}
                      {' · '}{trackingLabels[exercise.tracking_type]}
                    </small>
                  </span>
                </button>
                <button className={`exercise-square-button row-favourite ${exercise.is_favourite ? 'active' : ''}`} type="button" onClick={() => void toggleFavourite(exercise)} disabled={busy} aria-label={exercise.is_favourite ? `Убрать ${exercise.name} из избранного` : `Добавить ${exercise.name} в избранное`}>
                  <ActionIcon icon={exercise.is_favourite ? 'favourite' : 'favouriteEmpty'} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing === 'new' ? (
        <ExerciseEditorDialog saving={busy} error={editorError} onCancel={() => setEditing(null)} onSave={(input) => void saveEditor(input)} />
      ) : null}
    </section>
  );
}
