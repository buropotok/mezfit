import { useEffect, useState } from 'react';
import {
  createClientExercise,
  getClientExercises,
  type ExerciseDefinition,
  type TrackingType,
} from '../api';

const trackingLabels: Record<TrackingType, string> = {
  weight_reps: 'Вес × повторы',
  time: 'Время',
  time_distance: 'Время + дистанция',
  time_reps: 'Время + повторы',
  time_weight: 'Время + вес',
};

interface Props {
  initData: string;
  clientUserId: number;
}

export function ExerciseCatalog({ initData, clientUserId }: Props) {
  const [search, setSearch] = useState('');
  const [exercises, setExercises] = useState<ExerciseDefinition[] | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'coach' | 'client'>('client');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  const [primaryMuscle, setPrimaryMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
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

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    setSaving(true);
    setError('');
    try {
      await createClientExercise(initData, clientUserId, {
        scope,
        name: cleanName,
        trackingType,
        primaryMuscle: primaryMuscle.trim() || undefined,
        equipment: equipment.trim() || undefined,
      });
      const result = await getClientExercises(initData, clientUserId, search);
      setExercises(result.exercises);
      setName('');
      setPrimaryMuscle('');
      setEquipment('');
      setShowCreate(false);
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
          <button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Закрыть' : '+ Упражнение'}
          </button>
        </div>

        <input
          className="text-input"
          type="search"
          placeholder="Поиск упражнения…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {error ? <p className="inline-message error-text">{error}</p> : null}
        {exercises === null ? <p>Загружаем каталог…</p> : exercises.length === 0 ? (
          <div className="empty-state"><strong>Ничего не найдено</strong><p>Измените запрос или создайте своё упражнение.</p></div>
        ) : (
          <div className="exercise-list">
            {exercises.map((exercise) => (
              <div className="exercise-row" key={exercise.id}>
                <div>
                  <strong>{exercise.name}</strong>
                  <small>{trackingLabels[exercise.tracking_type]}{exercise.primary_muscle ? ` · ${exercise.primary_muscle}` : ''}</small>
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
        <section className="card form-card">
          <div className="eyebrow">Новое упражнение</div>
          <h2>Добавить в каталог</h2>
          <label className="field-label">Название<input className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
          <label className="field-label">Учёт результата
            <select className="text-input" value={trackingType} onChange={(event) => setTrackingType(event.target.value as TrackingType)}>
              {Object.entries(trackingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field-label">Основная мышца<input className="text-input" value={primaryMuscle} onChange={(event) => setPrimaryMuscle(event.target.value)} maxLength={80} /></label>
          <label className="field-label">Оборудование<input className="text-input" value={equipment} onChange={(event) => setEquipment(event.target.value)} maxLength={80} /></label>
          <label className="field-label">Доступность
            <select className="text-input" value={scope} onChange={(event) => setScope(event.target.value as 'coach' | 'client')}>
              <option value="client">Только этому клиенту</option>
              <option value="coach">Всем моим клиентам</option>
            </select>
          </label>
          <button className="primary-button full-width" type="button" disabled={saving || !name.trim()} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить упражнение'}</button>
        </section>
      ) : null}
    </section>
  );
}
