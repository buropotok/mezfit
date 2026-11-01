import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { List, ListInput, ListItem, Radio } from 'konsta/react';
import type { ClientIntake, ClientIntakeDefaults, ClientIntakeDraft, ClientIntakeSex } from '../data/cloud/client-intake';
import { ageFromBirthDate, ClientIntakeRepository, initialClientIntake, validateClientIntake } from '../data/cloud/client-intake';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { Button, DatePicker, GlassSurface, Text } from '../ui';
import { getTodayLocalDate, parseLocalDate } from '../ui/date-picker/datePickerDate';
import './client-intake.css';

const sexes: ReadonlyArray<{ value: ClientIntakeSex; label: string }> = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'undisclosed', label: 'Не указывать' },
];

function readableDate(value: string): string {
  const parts = parseLocalDate(value);
  return parts ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(parts.year, parts.month - 1, parts.day)) : '';
}

export function ClientIntakeForm({ defaults, onSave }: {
  defaults: ClientIntakeDefaults;
  onSave: (draft: ClientIntakeDraft) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<ClientIntakeDraft>(() => initialClientIntake(defaults));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const update = <K extends keyof ClientIntakeDraft>(key: K, value: ClientIntakeDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setSaveError('');
  };
  const validation = validateClientIntake(draft);
  const age = ageFromBirthDate(draft.birthDate);
  const today = getTodayLocalDate();
  const selectDate = parseLocalDate(draft.birthDate) ? draft.birthDate : `${new Date().getFullYear() - 25}-01-01`;
  const submit = async () => {
    if (busy.current) return;
    setAttempted(true);
    if (validation) return;
    busy.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(draft);
    } catch (reason) {
      if (alive.current) setSaveError(reason instanceof Error ? reason.message : 'Не удалось сохранить анкету');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return <section className="client-intake__form" aria-label="Анкета клиента">
    <Text variant="large-title">Анкета клиента</Text>
    <Text variant="body" tone="muted">Заполните данные для тренера. Имя, фамилию и Telegram можно изменить — первоначально они взяты из вашего профиля.</Text>
    <Text variant="caption" tone="muted">Анкета доступна только вам и тренерам, с которыми вы связаны в Mezfit.</Text>
    <List nested strong dividers={false} className="client-intake__inputs">
      <ListInput floatingLabel inputId={`${id}-first`} label="Имя" required
        value={draft.firstName} maxLength={100} disabled={saving}
        error={attempted && !draft.firstName.trim() ? 'Обязательное поле' : undefined}
        onChange={event => update('firstName', event.target.value)} />
      <ListInput floatingLabel inputId={`${id}-last`} label="Фамилия"
        value={draft.lastName} maxLength={100} disabled={saving}
        onChange={event => update('lastName', event.target.value)} />
      <ListInput floatingLabel inputId={`${id}-email`} type="email" label="E-mail"
        value={draft.email} maxLength={254} disabled={saving}
        onChange={event => update('email', event.target.value)} />
      <ListInput floatingLabel inputId={`${id}-phone`} type="tel" label="Телефон"
        value={draft.phone} maxLength={25} disabled={saving}
        onChange={event => update('phone', event.target.value)} />
      <ListInput floatingLabel inputId={`${id}-telegram`} label="Telegram username"
        value={draft.telegramUsername} maxLength={33} disabled={saving}
        onChange={event => update('telegramUsername', event.target.value)} />
    </List>
    <div className="client-intake__date">
      <Text variant="footnote" tone="muted">Дата рождения (для расчёта возраста)</Text>
      <Button variant="secondary" disabled={saving} onClick={() => setPickerOpen(true)}>
        {readableDate(draft.birthDate) || 'Выбрать дату рождения'}
      </Button>
      {age !== null ? <Text variant="body">Возраст: {age}</Text> : null}
    </div>
    <Text variant="headline">Пол</Text>
    <List nested strong dividers={false}>
      {sexes.map(option => <ListItem key={option.value} label
        title={option.label} onClick={() => { if (!saving) update('sex', option.value); }}
        media={<Radio name={`${id}-sex`} value={option.value}
          checked={draft.sex === option.value} disabled={saving}
          onChange={() => update('sex', option.value)} />} />)}
    </List>
    <List nested strong dividers={false}>
      <ListInput floatingLabel inputId={`${id}-weight`} type="number"
        inputMode="decimal" label="Вес, кг"
        value={draft.weightKg ?? ''} disabled={saving}
        onChange={event => update('weightKg', event.target.value === '' ? null : Number(event.target.value))} />
    </List>
    {attempted && validation ? <Text variant="footnote" role="alert">{validation}</Text> : null}
    {saveError ? <Text variant="footnote" role="alert">{saveError}</Text> : null}
    <Button disabled={saving} onClick={() => { void submit(); }}>
      {saving ? 'Сохранение…' : 'Сохранить анкету'}
    </Button>
    <DatePicker opened={pickerOpen} value={selectDate}
      minYear={1900} maxYear={new Date().getFullYear()} surface="panel"
      onChange={date => { if (date <= today) update('birthDate', date); setPickerOpen(false); }}
      onClose={() => setPickerOpen(false)} />
  </section>;
}

export function ClientRegistrationGate({ defaults, children }: {
  defaults: ClientIntakeDefaults;
  children: ReactNode;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new ClientIntakeRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [profile, setProfile] = useState<ClientIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const coaches = useMemo(() => cloud?.coaches.map(contact => ({
    relationshipId: contact.relationshipId, coachUserId: contact.userId,
  })) ?? [], [cloud?.coaches]);

  useEffect(() => {
    if (!repository) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    const sub = repository.observeOwn(value => {
      if (!active) return;
      setProfile(value);
      setLoading(false);
    }, reason => {
      if (!active) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить анкету');
    });
    return () => { active = false; sub.unsubscribe(); };
  }, [repository, retry]);

  useEffect(() => {
    if (!repository || !profile || !coaches.length) return;
    // Relationship-local copies follow the authoritative personal record.
    void repository.shareWithCoaches(profile, coaches).catch(() => {
      // Dexie offline writes remain queued; re-evaluate when relationship/sync state changes.
    });
  }, [repository, profile?.updatedAt, cloud?.syncStatus, coaches]);

  if (!repository || loading || cloud?.status === 'loading')
    return <section className="client-intake__status"><Text variant="body">Загрузка анкеты…</Text></section>;
  if (error || cloud?.status === 'error') return <section className="client-intake__status">
    <Text variant="body" role="alert">{error || cloud?.error || 'Нет доступа к данным анкеты'}</Text>
    <Button onClick={() => setRetry(value => value + 1)}>Повторить</Button>
  </section>;
  if (profile) return <>{children}</>;
  return <ClientIntakeForm defaults={defaults} onSave={async draft => {
    const saved = await repository.saveOwn(draft);
    await repository.shareWithCoaches(saved, coaches);
  }} />;
}

export function ClientIntakeOverview({ relationshipId, clientUserId }: {
  relationshipId: string; clientUserId: string;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new ClientIntakeRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const [profile, setProfile] = useState<ClientIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!repository) return undefined;
    let active = true;
    setLoading(true); setError(''); setProfile(null);
    const subscription = repository.observeForCoach(relationshipId, clientUserId, result => {
      if (!active) return;
      setProfile(result);
      setLoading(false);
    }, reason => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать анкету');
      setLoading(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, relationshipId, clientUserId]);

  if (loading) return <Text variant="body" tone="muted">Загрузка анкеты клиента…</Text>;
  if (error) return <Text variant="body" role="alert">{error}</Text>;
  if (!profile) return <GlassSurface preset="modalTuned" optics={false}
    contentClassName="client-intake__overview">
    <Text variant="headline">Анкета клиента</Text>
    <Text variant="body" tone="muted">Клиент ещё не заполнил анкету или данные пока не синхронизированы.</Text>
  </GlassSurface>;
  const entries = [
    ['Имя', profile.firstName], ['Фамилия', profile.lastName],
    ['E-mail', profile.email], ['Телефон', profile.phone],
    ['Telegram', profile.telegramUsername ? `@${profile.telegramUsername}` : ''],
    ['Дата рождения', readableDate(profile.birthDate)],
    ['Возраст', String(ageFromBirthDate(profile.birthDate) ?? '')],
    ['Пол', sexes.find(entry => entry.value === profile.sex)?.label ?? ''],
    ['Вес', profile.weightKg === null ? '' : `${profile.weightKg} кг`],
  ];
  return <GlassSurface component="section" preset="modalTuned" optics={false}
    contentClassName="client-intake__overview">
    <Text variant="headline">Анкета клиента</Text>
    {entries.map(([label, value]) => <div className="client-intake__overview-row" key={label}>
      <Text variant="footnote" tone="muted">{label}</Text>
      <Text variant="body">{value || '—'}</Text>
    </div>)}
  </GlassSurface>;
}
