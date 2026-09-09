import { useEffect, useState } from 'react';
import {
  createClientExercise,
  getClientExercises,
  type ExerciseCategoryCode,
  type ExerciseDefinition,
  type ExerciseEquipmentCode,
  type TrackingType,
} from '../api';

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

interface Props {
  initData: string;
  clientUserId: number;
}

function CategoryDialog({ value, onChange, onClose }: {
  value: ExerciseCategoryCode | null;
  onChange: (value: ExerciseCategoryCode) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop modal-backdrop-raised" role="presentation">
      <section className="modal-dialog category-dialog" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
        <header className="modal-header">
          <h2 id="category-dialog-title" className="modal-title">Категория</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть категории">×</button>
        </header>
        <div className="category-list" role="radiogroup" aria-label="Категория упражнения">
          {categoryOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              className="category-row"
              role="radio"
              aria-checked={value === option.code}
              onClick={() => { onChange(option.code); onClose(); }}
            >
              <span className={`category-accent category-${option.code}`} aria-hidden="true" />
              <span>{option.label}</span>
              <span className={`radio-mark ${value === option.code ? 'selected' : ''}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Отмена</button></div>
      </section>
    </div>
  );
}

export function ExerciseCatalog({ initData, clientUserId }: Props) {
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [mediaMessage, setMediaMessage] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'coach' | 'client'>('client');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  const [categoryCode, setCategoryCode] = useState<ExerciseCategoryCode | null>(null);
  const [equipmentCode, setEquipmentCode] = useState<ExerciseEquipmentCode | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getClientExercises(initData, clientUserId, search)
        .then(({ exercises: next }) => {
          if (!cancelled) {
            setExercises(next);
            setError('');
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить упражнения');
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientUserId, initData, search]);

  const resetCreate = () => {
    setName('');
    setDescription('');
    setScope('client');
    setTrackingType('weight_reps');
    setCategoryCode(null);
    setEquipmentCode(null);
    setMediaMessage('');
    setShowCategory(false);
  };

  const closeCreate = () => {
    if (saving) return;
    setShowCreate(false);
    resetCreate();
  };

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName || !categoryCode || !equipmentCode) return;
    setSaving(true);
    setError('');
    try {
      await createClientExercise(initData, clientUserId, {
        scope,
        name: cleanName,
        description: description.trim() || undefined,
        trackingType,
        categoryCode,
        equipmentCode,
      });
      const result = await getClientExercises(initData, clientUserId, search);
      setExercises(result.exercises);
      setShowCreate(false);
      resetCreate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать упражнение');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Упражнения клиента</div>
            <h2>Каталог</h2>
          </div>
          <button className="primary-button" type="button" onClick={() => setShowCreate(true)}>+ Упражнение</button>
        </div>

        <input
          className="text-input"
          type="search"
          placeholder="Поиск упражнения…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {error && !showCreate ? <p className="inline-message error-text">{error}</p> : null}
        {exercises === null ? <p>Загружаем каталог…</p> : exercises.length === 0 ? (
          <div className="empty-state"><strong>Ничего не найдено</strong><p>Измените запрос или создайте своё упражнение.</p></div>
        ) : (
          <div className="exercise-list">
            {exercises.map((exercise) => (
              <div className="exercise-row" key={exercise.id}>
                <div className="exercise-row-main">
                  {exercise.category_code ? <span className={`category-accent category-${exercise.category_code}`} aria-hidden="true" /> : null}
                  <div>
                    <strong>{exercise.name}</strong>
                    <small>
                      {trackingLabels[exercise.tracking_type]}
                      {exercise.category_code ? ` · ${categoryLabels[exercise.category_code]}` : ''}
                      {exercise.equipment_code ? ` · ${equipmentLabels[exercise.equipment_code]}` : ''}
                    </small>
                  </div>
                </div>
                <span className={`scope-badge scope-${exercise.scope}`}>
                  {exercise.scope === 'global' ? 'База' : exercise.scope === 'coach' ? 'Тренер' : 'Клиент'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {showCreate ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-dialog exercise-create-dialog" role="dialog" aria-modal="true" aria-labelledby="exercise-create-title">
            <header className="modal-header">
              <h2 id="exercise-create-title" className="modal-title">Новое упражнение</h2>
              <button className="icon-button" type="button" onClick={closeCreate} disabled={saving} aria-label="Закрыть">×</button>
            </header>

            <div className="exercise-create-first-row">
              <button
                type="button"
                className="exercise-media-slot"
                onClick={() => setMediaMessage('Добавление фото и анимации будет подключено в задаче #34.')}
                aria-label="Добавить изображение или анимацию"
              >
                <span aria-hidden="true">🏋️</span>
                <small>Медиа</small>
              </button>
              <div className="exercise-create-text-fields">
                <label className="compact-field-label">Название
                  <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
                </label>
                <label className="compact-field-label">Описание
                  <textarea className="text-input exercise-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} />
                </label>
              </div>
            </div>
            {mediaMessage ? <p className="media-note">{mediaMessage}</p> : null}

            <label className="field-label">Учёт результата
              <select className="text-input" value={trackingType} onChange={(event) => setTrackingType(event.target.value as TrackingType)}>
                {Object.entries(trackingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>

            <div className="field-label">
              <span>Категория</span>
              <button className="selector-button" type="button" onClick={() => setShowCategory(true)}>
                <span>{categoryCode ? categoryLabels[categoryCode] : 'Выбрать категорию'}</span><span aria-hidden="true">›</span>
              </button>
            </div>

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
                  >{option.label}</button>
                ))}
              </div>
            </div>

            <label className="field-label">Доступность
              <select className="text-input" value={scope} onChange={(event) => setScope(event.target.value as 'coach' | 'client')}>
                <option value="client">Только этому клиенту</option>
                <option value="coach">Всем моим клиентам</option>
              </select>
            </label>

            {error ? <p className="inline-message error-text">{error}</p> : null}
            <div className="modal-actions">
              <button className="text-button" type="button" disabled={saving} onClick={closeCreate}>Отмена</button>
              <button className="positive-button" type="button" disabled={saving || !name.trim() || !categoryCode || !equipmentCode} onClick={save}>
                {saving ? 'Добавляем…' : 'Добавить'}
              </button>
            </div>
          </section>
          {showCategory ? <CategoryDialog value={categoryCode} onChange={setCategoryCode} onClose={() => setShowCategory(false)} /> : null}
        </div>
      ) : null}
    </section>
  );
}
