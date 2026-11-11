import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { List, ListInput } from 'konsta/react';
import type { UserProfile, UserProfileDefaults, UserProfileDraft, UserProfileField, UserProfileSex } from '../data/cloud/user-profile';
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

export function UserProfileForm({ defaults, initialProfile, telegramUserId, telegramUsername, onSave, syncStatus, purpose = 'self', onCancel, overridden = [], onReset }: {
  syncStatus?: ReactNode;
  overridden?: readonly UserProfileField[];
  onReset?: (field: UserProfileField) => Promise<UserProfile | undefined>;
  purpose?: 'self' | 'contact';
  onCancel?: () => void;
  defaults: UserProfileDefaults;
  initialProfile: UserProfile | null;
  telegramUserId: string;
  telegramUsername: string | null;
  onSave: (draft: UserProfileDraft, changedFields?: readonly UserProfileField[]) => Promise<void>;
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
  const changedFields = useRef(new Set<UserProfileField>());
  useEffect(() => {
    if (initialProfile && !dirty.current && !busy.current) setDraft(initialUserProfileDraft(initialProfile));
  }, [initialProfile]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const update = <K extends keyof UserProfileDraft>(key: K, value: UserProfileDraft[K]) => {
    dirty.current = true;
    changedFields.current.add(key);
    setDraft(current => ({ ...current, [key]: value }));
    setSaveError('');
    setSaved(false);
  };
  const resetField = async (field: UserProfileField) => {
    if (!onReset || busy.current) return;
    busy.current = true; setSaving(true); setSaveError('');
    try {
      const profile = await onReset(field);
      if (alive.current && profile) {
        changedFields.current.delete(field);
        dirty.current = changedFields.current.size > 0;
        setDraft(current => ({ ...current, [field]: profile[field] }));
        setSaved(false);
      }
    } catch {
      if (alive.current) setSaveError('Не удалось сбросить переопределение. Повторите действие.');
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const labels: Record<UserProfileField, string> = { firstName: 'Имя', lastName: 'Фамилия', email: 'E-mail', phone: 'Телефон', birthDate: 'Дата рождения', sex: 'Пол', weightKg: 'Вес, кг' };
  const overrideControl = (field: UserProfileField) => purpose === 'contact' && onReset && overridden.includes(field) ? <div className="stack">
    <Text variant="caption" tone="muted">Переопределено в этой связи</Text>
    <Button variant="secondary" size="compact" disabled={saving} onClick={() => { void resetField(field); }}>Сбросить: {labels[field]}</Button>
  </div> : null;
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
      if (purpose === 'contact') await onSave(draft, [...changedFields.current]);
      else await onSave(draft);
      dirty.current = false;
      changedFields.current.clear();
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
    <Text variant="body" tone="muted">{purpose === 'contact'
      ? 'Сохраняются только изменённые вами поля. Собственная анкета клиента не меняется.'
      : 'Все поля необязательны. Имя и фамилию можно изменить независимо от Telegram.'}</Text>
    <Text variant="caption" tone="muted">{purpose === 'contact'
      ? 'Переопределения действуют только в этой связи. Сброс доступен рядом с каждым изменённым полем.'
      : 'Анкета сохраняется в личном профиле и автоматически публикуется для подтверждённых контактов.'}</Text>
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
    {(['firstName', 'lastName', 'email', 'phone'] as const).map(field => <div key={field}>{overrideControl(field)}</div>)}
    {purpose === 'self' ? <GlassSurface preset="modalTuned" optics={false} shape="auto">
      <div className="user-profile__details">
        <div className="user-profile__field">
          <Text variant="caption">Telegram ID</Text>
          <Text variant="headline">{telegramUserId}</Text>
        </div>
        {purpose === 'self' ? <div className="user-profile__field">
          <Text variant="caption">Telegram</Text>
          <Text variant="headline">{telegramUsername ? '@' + telegramUsername : 'Не указан'}</Text>
        </div> : null}
        <div className="user-profile__field">
          <Text variant="caption">Дата рождения</Text>
          <Text variant="headline">{readableDate(draft.birthDate) || 'Не указана'}</Text>
          <Button variant="secondary" size="compact" disabled={saving} onClick={() => setPickerOpen(true)}>
            {draft.birthDate ? 'Изменить дату рождения' : 'Выбрать дату рождения'}
          </Button>
          {draft.birthDate ? <Button variant="secondary" size="compact" disabled={saving}
            onClick={() => update('birthDate', '')}>Убрать дату рождения</Button> : null}
        </div>
        {overrideControl('birthDate')}
        {age !== null ? <div className="user-profile__field">
          <Text variant="caption">Возраст</Text>
          <Text variant="headline">{age}</Text>
        </div> : null}
        <div className="user-profile__field">
          <Text variant="caption">Пол</Text>
          <Text variant="headline">{draft.sex === 'male' ? 'муж' : draft.sex === 'female' ? 'жен' : 'не указан'}</Text>
          <LiquidPopover isOpen={sexOpen} onOpenChange={setSexOpen} triggerRef={sexTrigger}
            label="Выберите пол" triggerActivation="controlled"
            items={sexes.map(option => ({ id: option.value, label: option.label, active: draft.sex === option.value,
              onSelect: () => { if (!saving) update('sex', option.value); setSexOpen(false); } }))}
            trigger={<span ref={sexTrigger}><Button variant="secondary" size="compact" disabled={saving}
              onClick={() => setSexOpen(true)}>Изменить пол</Button></span>} />
        </div>
        {overrideControl('sex')}
        <List nested strong={false} dividers={false}>
          <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-weight`} type="number"
            inputMode="decimal" label="Вес, кг"
            value={draft.weightKg ?? ''} disabled={saving}
            onChange={event => update('weightKg', event.target.value === '' ? null : Number(event.target.value))} />
        </List>
        {overrideControl('weightKg')}
      </div>
    </GlassSurface> : <>
      <Text variant="caption">Telegram ID</Text>
      <Text variant="headline">{telegramUserId}</Text>
      <div className="user-profile__date">
        <Text variant="caption">Дата рождения</Text>
        <Button variant="secondary" disabled={saving} onClick={() => setPickerOpen(true)}>
          {readableDate(draft.birthDate) || 'Выбрать дату рождения'}
        </Button>
        {draft.birthDate ? <Button variant="secondary" disabled={saving}
          onClick={() => update('birthDate', '')}>Убрать дату рождения</Button> : null}
        {age !== null ? <Text variant="headline">Возраст: {age}</Text> : null}
      </div>
      {overrideControl('birthDate')}
      <LiquidPopover isOpen={sexOpen} onOpenChange={setSexOpen} triggerRef={sexTrigger}
        label="Выберите пол" triggerActivation="controlled"
        items={sexes.map(option => ({ id: option.value, label: option.label, active: draft.sex === option.value,
          onSelect: () => { if (!saving) update('sex', option.value); setSexOpen(false); } }))}
        trigger={<span ref={sexTrigger}><Button variant="secondary" disabled={saving} onClick={() => setSexOpen(true)}>
          <Text variant="caption">Пол:</Text>{' '}<Text variant="headline">{draft.sex === 'male' ? 'муж' : draft.sex === 'female' ? 'жен' : 'не указан'}</Text>
        </Button></span>} />
      {overrideControl('sex')}
      <GlassSurface preset="modalTuned" optics={false} shape="auto">
        <List nested strong={false} dividers={false}>
          <ListInput colors={{ bgIos: 'bg-transparent' }} floatingLabel inputId={`${id}-weight`} type="number"
            inputMode="decimal" label="Вес, кг"
            value={draft.weightKg ?? ''} disabled={saving}
            onChange={event => update('weightKg', event.target.value === '' ? null : Number(event.target.value))} />
        </List>
      </GlassSurface>
      {overrideControl('weightKg')}
    </>}
    {attempted && validation ? <Text variant="footnote" role="alert">{validation}</Text> : null}
    {saved ? <Text variant="footnote" role="status">{purpose === 'contact' ? 'Переопределения сохранены на устройстве.' : 'Анкета сохранена на устройстве.'}</Text> : null}
    {saveError ? <Text variant="footnote" role="alert">{saveError}</Text> : null}
    <Button disabled={saving || (purpose === 'contact' && changedFields.current.size === 0)} onClick={() => { void submit(); }}>
      {saving ? 'Сохранение…' : purpose === 'contact' ? 'Сохранить переопределения' : 'Сохранить анкету'}
    </Button>
    {onCancel ? <Button variant="secondary" disabled={saving} onClick={onCancel}>Отменить</Button> : null}
    {initialProfile ? <Text variant="caption" tone="muted">Изменено: {new Date(initialProfile.updatedAt).toLocaleString('ru-RU')}</Text> : null}
    <DatePicker opened={pickerOpen} value={selectDate}
      minYear={1900} maxYear={new Date().getFullYear()} surface="panel"
      onChange={date => { if (date <= today) update('birthDate', date); setPickerOpen(false); }}
      onClose={() => setPickerOpen(false)} />
  </section>;
}
