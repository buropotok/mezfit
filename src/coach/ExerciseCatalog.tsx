import { useEffect, useState } from 'react';
import {
  createClientExercise,
  getClientExercises,
  type ExerciseCategoryCode,
  type ExerciseDefinition,
  type ExerciseEquipmentCode,
  type TrackingType,
} from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { Button, Dropdown, FloatingActionButton, List, ListItem, Modal, Text, TextArea, TextInput } from '../ui';

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
const trackingDropdownOptions = Object.entries(trackingLabels).map(([value, label]) => ({ value, label }));
const categoryDropdownOptions = categoryOptions.map(({ code, label }) => ({ value: code, label }));
const equipmentDropdownOptions = equipmentOptions.map(({ code, label }) => ({ value: code, label }));
const scopeDropdownOptions = [
  { value: 'client', label: 'Только этому клиенту' },
  { value: 'coach', label: 'Всем моим клиентам' },
];

interface Props {
  initData: string;
  clientUserId: number;
}

export function ExerciseCatalog({ initData, clientUserId }: Props) {
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
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

  const canSave = Boolean(name.trim() && categoryCode && equipmentCode);

  return <section className="exercise-catalog stack">
    <header className="exercise-catalog-header">
      <div><div className="eyebrow">Упражнения клиента</div><h2>Каталог</h2></div>
    </header>
    <div className="exercise-catalog-search">
      <input className="text-input" type="search" aria-label="Поиск упражнения" placeholder="Поиск упражнения…" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {error && !showCreate ? <p className="inline-message error-text">{error}</p> : null}
    <section className="exercise-catalog-directory" aria-live="polite">
      <div className="exercise-catalog-scroll">
        {exercises === null ? <p className="catalogue-status">Загружаем каталог…</p> : exercises.length === 0 ? (
          <div className="empty-state catalogue-empty"><strong>Ничего не найдено</strong><p>Измените запрос или создайте своё упражнение.</p></div>
        ) : (
          <List className="exercise-list">
            {exercises.map((exercise) => (
              <ListItem
                key={exercise.id}
                interactive={false}
                leadingShape="square"
                leading={<ExerciseMedia exercise={exercise} />}
                title={exercise.name}
                subtitle={<>{trackingLabels[exercise.tracking_type]}{exercise.category_code ? ` · ${categoryLabels[exercise.category_code]}` : ''}{exercise.equipment_code ? ` · ${equipmentLabels[exercise.equipment_code]}` : ''}</>}
                trailing={<span className={`scope-badge scope-${exercise.scope}`}>{exercise.scope === 'global' ? 'База' : exercise.scope === 'coach' ? 'Тренер' : 'Клиент'}</span>}
              />
            ))}
          </List>
        )}
      </div>
      <FloatingActionButton label="Добавить упражнение" onClick={() => setShowCreate(true)}>+</FloatingActionButton>
    </section>

    <Modal
      isOpen={showCreate}
      title="Новое упражнение"
      onClose={closeCreate}
      closeOnBackdrop={!saving}
      hasCloseButton={false}
      className="exercise-create-modal"
      actions={[
        { id: 'cancel', label: 'Отмена', onClick: closeCreate, disabled: saving },
        { id: 'save', label: saving ? 'Добавляем…' : 'Добавить', tone: 'primary', onClick: () => { void save(); }, disabled: saving || !canSave },
      ]}
    >
      <div className="exercise-create-first-row">
        <Button
          variant="secondary"
          className="exercise-media-slot"
          disabled={saving}
          onClick={() => setMediaMessage('Собственные фото и анимации для пользовательских упражнений будут добавлены позже.')}
          aria-label="Добавить изображение или анимацию"
        >
          <Text variant="caption">Медиа</Text>
        </Button>
        <div className="exercise-create-text-fields">
          <TextInput label="Название" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus disabled={saving} />
          <TextArea label="Описание" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} disabled={saving} />
        </div>
      </div>
      {mediaMessage ? <Text variant="footnote" tone="muted" className="exercise-create-note">{mediaMessage}</Text> : null}

      <div className="exercise-create-fields">
        <div className="exercise-create-field">
          <Text variant="footnote" className="exercise-create-field-label">Учёт результата</Text>
          <Dropdown
            mode="single"
            variant="field"
            title="Учёт результата"
            options={trackingDropdownOptions}
            value={trackingType}
            onChange={(value) => setTrackingType(value as TrackingType)}
            disabled={saving}
            triggerProps={{ 'aria-label': 'Учёт результата' }}
          />
        </div>
        <div className="exercise-create-field">
          <Text variant="footnote" className="exercise-create-field-label">Категория</Text>
          <Dropdown
            mode="single"
            variant="field"
            title="Категория"
            placeholder="Выбрать категорию"
            options={categoryDropdownOptions}
            value={categoryCode}
            onChange={(value) => setCategoryCode(value as ExerciseCategoryCode)}
            disabled={saving}
            triggerProps={{ 'aria-label': 'Категория' }}
          />
        </div>
        <div className="exercise-create-field">
          <Text variant="footnote" className="exercise-create-field-label">Оборудование</Text>
          <Dropdown
            mode="single"
            variant="field"
            title="Оборудование"
            placeholder="Выбрать оборудование"
            options={equipmentDropdownOptions}
            value={equipmentCode}
            onChange={(value) => setEquipmentCode(value as ExerciseEquipmentCode)}
            disabled={saving}
            triggerProps={{ 'aria-label': 'Оборудование' }}
          />
        </div>
        <div className="exercise-create-field">
          <Text variant="footnote" className="exercise-create-field-label">Доступность</Text>
          <Dropdown
            mode="single"
            variant="field"
            title="Доступность"
            options={scopeDropdownOptions}
            value={scope}
            onChange={(value) => setScope(value as 'coach' | 'client')}
            disabled={saving}
            triggerProps={{ 'aria-label': 'Доступность' }}
          />
        </div>
      </div>

      {error ? <Text variant="footnote" className="exercise-create-error" role="alert">{error}</Text> : null}
    </Modal>
  </section>;
}
