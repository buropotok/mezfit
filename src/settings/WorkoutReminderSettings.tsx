import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { COACH_TELEGRAM_PREFERENCES } from '../../shared/telegram-notification-link';
import { Toggle } from 'konsta/react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import {
  DEFAULT_WORKOUT_REMINDER_PREFERENCES,
  WORKOUT_REMINDER_KEYS,
  WorkoutReminderPreferencesRepository,
  type WorkoutReminderPreference,
} from '../data/cloud/workout-reminder-preferences';
import { GlassSurface, Text } from '../ui';
import './workout-reminder-settings.css';

const KEYS = { ...WORKOUT_REMINDER_KEYS, ...COACH_TELEGRAM_PREFERENCES };
const DEFAULTS = { ...DEFAULT_WORKOUT_REMINDER_PREFERENCES, telegram: true, discussion: true };
type Preference = WorkoutReminderPreference | keyof typeof COACH_TELEGRAM_PREFERENCES;

type Role = 'coach' | 'client';

const TELEGRAM_FIELDS = [
  { key: 'telegram', title: 'Уведомления в Telegram',
    description: 'Все уведомления тренера в чате с ботом.' },
  { key: 'discussion', title: 'Сообщения клиентов',
    description: 'Новые сообщения в обсуждениях.' },
] as const;

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
  const showCoachTelegram = role === 'coach';
  const cloud = useCloudConnections();
  const repo = useMemo(() => cloud
    ? new WorkoutReminderPreferencesRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [values, setValues] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    generationRef.current += 1;
    mountedRef.current = true;
    savingRef.current = false;
    setLoading(true);
    setLoaded(false);
    setError('');
    if (!repo) {
      setLoading(false);
      setError('Не удалось подключиться к личным настройкам.');
      return () => { active = false; generationRef.current += 1; mountedRef.current = false; };
    }
    const subscription = liveQuery(() => showCoachTelegram
      ? repo.readKeys(KEYS, DEFAULTS) : repo.read().then(values => ({ ...DEFAULTS, ...values }))).subscribe({
      next: next => {
        if (!active) return;
        if (!savingRef.current) setValues(next);
        setLoaded(true);
        setLoading(false);
      },
      error: () => {
        if (!active) return;
        setLoading(false);
        setLoaded(false);
        setError('Не удалось загрузить настройки уведомлений.');
      },
    });
    return () => {
      active = false;
      generationRef.current += 1;
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [repo, showCoachTelegram]);

  const change = async (key: Preference) => {
    if (!repo || savingRef.current || loading || !loaded) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const revision = generationRef.current;
    const previous = values;
    const enabled = !previous[key];
    setValues({ ...previous, [key]: enabled });
    let persisted = false;
    try {
      await repo.setBoolean(KEYS[key], enabled);
      persisted = true;
      // A subscription update may have been suppressed while this local write was pending.
      const latest = showCoachTelegram ? await repo.readKeys(KEYS, DEFAULTS) : { ...DEFAULTS, ...await repo.read() };
      if (mountedRef.current && revision === generationRef.current) setValues(latest);
    } catch {
      if (mountedRef.current && revision === generationRef.current) {
        if (!persisted) setValues(previous);
        setError(persisted
          ? 'Настройка сохранена, но не удалось повторно прочитать её. Откройте настройки заново.'
          : 'Не удалось сохранить настройку. Повторите попытку.');
      }
    } finally {
      if (revision === generationRef.current) {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    }
  };

  const fields = showCoachTelegram ? [...TELEGRAM_FIELDS, ...COACH_FIELDS] : role === 'coach' ? COACH_FIELDS : CLIENT_FIELDS;
  return (
    <GlassSurface component="section" wrapContent={false} preset="modalTuned" optics={false}
      blur={glassBlur} shape={{ radius: 16 }} className="workout-reminder-settings__panel">
      <Text variant="title">Уведомления</Text>
      <Text variant="footnote" tone="muted">{showCoachTelegram ? 'Сообщения и напоминания через Telegram-бота.' : 'Напоминания через Telegram-бота за час до тренировки.'}</Text>
      {fields.map(field => (
        <label className="workout-reminder-settings__row" key={field.key}>
          <span className="workout-reminder-settings__copy">
            <Text variant="body">{field.title}</Text>
            <Text variant="footnote" tone="muted">{field.description}</Text>
          </span>
          <span className="workout-reminder-settings__toggle-slot">
            <Toggle component="span" checked={values[field.key]} disabled={!repo || !loaded || loading || saving || (showCoachTelegram && field.key !== 'telegram' && !values.telegram)}
              onChange={() => { void change(field.key); }} />
          </span>
        </label>
      ))}
      <Text variant="footnote" tone="muted">
        Чтобы получать сообщения, <a href="https://t.me/mezfit_bot?start=workout_reminders" target="_blank" rel="noopener noreferrer">откройте бота</a>
        {' '}и нажмите Start. Настройки сохраняются на устройстве и синхронизируются с Dexie Cloud.
      </Text>
      {cloud?.syncStatus === 'offline' || cloud?.syncStatus === 'error'
        ? <Text variant="footnote" tone="muted">Облачная синхронизация не подтверждена. Изменения вступят в силу после синхронизации.</Text>
        : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </GlassSurface>
  );
}
