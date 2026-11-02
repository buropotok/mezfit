import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { List, ListInput } from 'konsta/react';
import type { UserProfile, UserProfileDefaults, UserProfileDraft, UserProfileSex } from '../data/cloud/user-profile';
import { ageFromBirthDate, initialUserProfile, validateUserProfile } from '../data/cloud/user-profile';
import { Button, DatePicker, GlassSurface, LiquidPopover, Text } from '../ui';
import { getTodayLocalDate, parseLocalDate } from '../ui/date-picker/datePickerDate';
import './user-profile.css';

function initialUserProfileDraft(profile: UserProfile): UserProfileDraft {
  const { updatedAt: _updatedAt, ...draft } = profile;
  return draft;
}

const sexes: ReadonlyArray<{ value: UserProfileSex; label: string }> = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'undisclosed', label: 'Не указывать' },
];

function readableDate(value: string): string {
  const parts = parseLocalDate(value);
  return parts ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(parts.year, parts.month - 1, parts.day)) : '';
}

export function UserProfileForm({ defaults, initialProfile, telegramUserId, telegramUsername, onSave, syncStatus }: {
  syncStatus?: ReactNode;
  defaults: UserProfileDefaults;
  initialProfile: UserProfile | null;
  telegramUserId: string;
  telegramUsername: string | null;
  onSave: (draft: UserProfileDraft) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<UserProfileDraft>(() => initialProfile ? initialUserProfileDraft(initialProfile) : initialUserProfile(defaults));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sexOpen, setSexOpen] = useState(false);
  const sexTrigger = useRef<HTMLSpanElement>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    if (initialProfile && !dirty.current && !busy.current) setDraft(initialUserProfileDraft(initialProfile));
  }, [initialProfile]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const update = <K extends keyof UserProfileDraft>(key: K, value: UserProfileDraft[K]) => {
    dirty.current = true;
    setDraft(current => ({ ...current, [key]: value }));
    setSaveError('');
    setSaved(false);
  };
  const validation = validateUserProfile(draft);
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
      dirty.current = false;
      if (alive.current) setSaved(true);
    } catch (reason) {
      if (alive.current) setSaveError(reason instanceof Error ? reason.message : 'Не удалось сохранить анкету');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return <section className="user-profile__form" aria-label="Анкета пользователя">
    <div className="user-profile__heading"><div className="user-profile__heading-title"><Text variant="title">Анкета пользователя</Text></div>{syncStatus}</div>
    <Text variant="body" tone="muted">Все поля необязательны. Имя и фамилию можно изменить независимо от Telegram.</Text>
    <Text variant="caption" tone="muted">Анкета сохраняется в личном профиле и автоматически публикуется для подтверждённых контактов.</Text>
    <GlassSurface preset="modalTuned" optics={false} shape="auto">
      <List nested strong={false} dividers={false} className="user-profile__inputs">
        <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-first`} label="Имя"
          value={draft.firstName} maxLength={100} disabled={saving}
          onChange={event => update('firstName', event.target.value)} />
        <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-last`} label="Фамилия"
          value={draft.lastName} maxLength={100} disabled={saving}
          onChange={event => update('lastName', event.target.value)} />
        <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-email`} type="email" label="E-mail"
          value={draft.email} maxLength={254} disabled={saving}
          onChange={event => update('email', event.target.value)} />
        <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-phone`} type="tel" label="Телефон"
          value={draft.phone} maxLength={25} disabled={saving}
          onChange={event => update('phone', event.target.value)} />
      </List>
    </GlassSurface>
    <Text variant="headline">Telegram ID</Text>
    <Text variant="body">{telegramUserId}</Text>
    <Text variant="headline">Telegram</Text>
    <Text variant="body">{telegramUsername ? '@' + telegramUsername : 'Не указан'}</Text>
    <div className="user-profile__date">
      <Text variant="headline">Дата рождения</Text>
      <Button variant="secondary" disabled={saving} onClick={() => setPickerOpen(true)}>
        {readableDate(draft.birthDate) || 'Выбрать дату рождения'}
      </Button>
      {draft.birthDate ? <Button variant="secondary" disabled={saving} onClick={() => update('birthDate', '')}>Убрать дату рождения</Button> : null}
      {age !== null ? <Text variant="body">Возраст: {age}</Text> : null}
    </div>
    <Text variant="headline">Пол</Text>
    <LiquidPopover isOpen={sexOpen} onOpenChange={setSexOpen} triggerRef={sexTrigger}
      label="Выберите пол" triggerActivation="controlled"
      items={sexes.map(option => ({ id: option.value, label: option.label, active: draft.sex === option.value,
        onSelect: () => { if (!saving) update('sex', option.value); setSexOpen(false); } }))}
      trigger={<span ref={sexTrigger}><Button variant="secondary" disabled={saving} onClick={() => setSexOpen(true)}>
        <Text variant="body">Пол: {draft.sex === 'male' ? 'муж' : draft.sex === 'female' ? 'жен' : 'не указан'}</Text>
      </Button></span>} />
    <GlassSurface preset="modalTuned" optics={false} shape="auto">
      <List nested strong={false} dividers={false}>
        <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-weight`} type="number"
          inputMode="decimal" label="Вес, кг"
          value={draft.weightKg ?? ''} disabled={saving}
          onChange={event => update('weightKg', event.target.value === '' ? null : Number(event.target.value))} />
      </List>
    </GlassSurface>
    {attempted && validation ? <Text variant="footnote" role="alert">{validation}</Text> : null}
    {saved ? <Text variant="footnote" role="status">Анкета сохранена на устройстве.</Text> : null}
    {saveError ? <Text variant="footnote" role="alert">{saveError}</Text> : null}
    <Button disabled={saving} onClick={() => { void submit(); }}>
      {saving ? 'Сохранение…' : 'Сохранить анкету'}
    </Button>
    {initialProfile ? <Text variant="caption" tone="muted">Изменено: {new Date(initialProfile.updatedAt).toLocaleString('ru-RU')}</Text> : null}
    <DatePicker opened={pickerOpen} value={selectDate}
      minYear={1900} maxYear={new Date().getFullYear()} surface="panel"
      onChange={date => { if (date <= today) update('birthDate', date); setPickerOpen(false); }}
      onClose={() => setPickerOpen(false)} />
  </section>;
}
