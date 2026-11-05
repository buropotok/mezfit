import { useEffect, useMemo, useRef, useState } from 'react';
import { Toggle } from 'konsta/react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import {
  DEFAULT_WORKOUT_REMINDER_PREFERENCES,
  WorkoutReminderPreferencesRepository,
  type WorkoutReminderPreference,
  type WorkoutReminderPreferences,
} from '../data/cloud/workout-reminder-preferences';
import { GlassSurface, Text } from '../ui';
import './workout-reminder-settings.css';

type Role = 'coach' | 'client';

const COACH_FIELDS = [
  { key: 'coached', title: 'Тренировки с клиентами',
    description: 'Совместные тренировки в зале, где вы участвуете как тренер.' },
  { key: 'own', title: 'Мои самостоятельные тренировки',
    description: 'Личные тренировки, где вы сами выступаете атлетом.' },
] as const;

const CLIENT_FIELDS = [
  { key: 'client', title: 'Напоминания о тренировках',
    description: 'Самостоятельные тренировки и занятия с тренером.' },
] as const;

export function WorkoutReminderSettings({ role, glassBlur }: { role: Role; glassBlur?: number }) {
  const cloud = useCloudConnections();
  const repo = useMemo(() => cloud
    ? new WorkoutReminderPreferencesRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [values, setValues] = useState<WorkoutReminderPreferences>({ ...DEFAULT_WORKOUT_REMINDER_PREFERENCES });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    savingRef.current = false;
    setLoading(true);
    setError('');
    if (!repo) {
      setLoading(false);
      setError('Не удалось подключиться к личным настройкам.');
      return () => { active = false; mountedRef.current = false; };
    }
    const subscription = repo.observe(
      next => {
        if (!active) return;
        if (!savingRef.current) setValues(next);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setLoading(false);
        setError('Не удалось загрузить настройки уведомлений.');
      },
    );
    return () => { active = false; mountedRef.current = false; subscription.unsubscribe(); };
  }, [repo]);

  const change = async (key: WorkoutReminderPreference) => {
    if (!repo || savingRef.current || loading) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const previous = values;
    const enabled = !previous[key];
    setValues({ ...previous, [key]: enabled });
    try {
      await repo.set(key, enabled);
    } catch {
      if (mountedRef.current) {
        setValues(previous);
        setError('Не удалось сохранить настройку. Повторите попытку.');
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const fields = role === 'coach' ? COACH_FIELDS : CLIENT_FIELDS;
  return (
    <GlassSurface component="section" wrapContent={false} preset="modalTuned" optics={false}
      blur={glassBlur} shape={{ radius: 16 }} className="settings-page__section">
      <Text variant="title">Уведомления</Text>
      <Text variant="footnote" tone="muted">Напоминания через Telegram-бота за час до тренировки.</Text>
      {fields.map(field => (
        <label className="workout-reminder-settings__row" key={field.key}>
          <span className="workout-reminder-settings__copy">
            <Text variant="body">{field.title}</Text>
            <Text variant="footnote" tone="muted">{field.description}</Text>
          </span>
          <Toggle component="span" checked={values[field.key]} disabled={!repo || loading || saving}
            onChange={() => { void change(field.key); }} />
        </label>
      ))}
      <Text variant="footnote" tone="muted">
        Для доставки сообщений откройте чат @mezfit_bot и нажмите Start. Настройки сохраняются
        на устройстве и синхронизируются с Dexie Cloud.
      </Text>
      {cloud?.syncStatus === 'offline' || cloud?.syncStatus === 'error'
        ? <Text variant="footnote" tone="muted">Облачная синхронизация не подтверждена. Изменения вступят в силу после синхронизации.</Text>
        : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </GlassSurface>
  );
}
