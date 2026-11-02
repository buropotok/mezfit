import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserProfileRepository, ageFromBirthDate, type ContactUserProfile, type UserProfile, type UserProfileDraft, type UserProfileField } from '../data/cloud/user-profile';
import { Button, GlassSurface, Text } from '../ui';
import { UserAvatarEditor } from './UserAvatarEditor';
import { UserProfileForm } from './UserProfileForm';

/** Reads only the existing relationship realm; private peer data is never queried. */
export function PublishedUserProfile({ contact }: { contact: CloudContact }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud?.db && cloud.actorUserId ? new UserProfileRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [snapshot, setSnapshot] = useState<{ repository: UserProfileRepository; key: string; data: ContactUserProfile | null; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [avatarEditing, setAvatarEditing] = useState(false);
  const key = cloud?.actorUserId + ':' + contact.relationshipId + ':' + contact.userId;
  const [editor, setEditor] = useState<{ repository: UserProfileRepository; key: string; profile: UserProfile } | null>(null);
  const [pending, setPending] = useState<{ repository: UserProfileRepository; key: string } | null>(null);
  const [message, setMessage] = useState<{ repository: UserProfileRepository; key: string; text: string; error: boolean } | null>(null);
  const active = useRef<{ repository: UserProfileRepository | null; key: string }>({ repository, key });
  const busy = useRef(false);
  useLayoutEffect(() => {
    active.current = { repository, key };
    busy.current = false;
    // A new visit must not reactivate the prior visit's editor, pending action
    // or notice when the user returns to the same relationship.
    setSnapshot(null);
    setEditor(null);
    setAvatarEditing(false);
    setPending(null);
    setMessage(null);
    return () => { active.current = { repository: null, key: '' }; };
  }, [repository, key]);
  const isCurrent = (owner: typeof active.current) => active.current === owner;
  useEffect(() => {
    if (!repository) return;
    let active = true;
    const subscription = repository.observeContact(contact.userId, contact.relationshipId,
      data => { if (active) setSnapshot({ repository, key, data, error: false }); },
      () => { if (active) setSnapshot(previous => previous?.repository === repository && previous.key === key
        ? { ...previous, error: true } : { repository, key, data: null, error: true }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, contact.userId, contact.relationshipId, key, retry]);
  const current = snapshot?.repository === repository && snapshot?.key === key ? snapshot : null;
  const data = current?.data;
  const profile = data?.profile;
  const editing = editor?.repository === repository && editor?.key === key;
  const resetting = pending?.repository === repository && pending?.key === key;
  const notice = message?.repository === repository && message?.key === key ? message : null;
  const reset = async (field: UserProfileField) => {
    if (!repository || busy.current) return;
    const owner = active.current;
    busy.current = true;
    setPending({ repository, key });
    setMessage(null);
    try {
      const saved = await repository.resetContactOverride(contact.userId, contact.relationshipId, field);
      if (isCurrent(owner)) {
        setSnapshot({ repository, key, data: saved, error: false });
        setMessage({ repository, key, text: 'Сброс сохранён на устройстве. Используются данные клиента.', error: false });
      }
      return saved.profile ?? undefined;
    } catch {
      if (isCurrent(owner)) setMessage({ repository, key, text: 'Не удалось сбросить переопределение. Повторите действие.', error: true });
    } finally {
      if (isCurrent(owner)) { busy.current = false; setPending(null); }
    }
  };
  if (editing && repository && editor) return <section className="stack">
    {current?.error || data?.incomplete || !profile ? <Text variant="body" role="alert">Не удалось обновить анкету. Черновик сохранён в форме.</Text> : null}
    <UserAvatarEditor contact={contact} editable={data?.canEdit === true} />
    {notice ? <Text variant="footnote" role={notice.error ? 'alert' : 'status'}>{notice.text}</Text> : null}
    <UserProfileForm key={key} overridden={data?.overridden} onReset={reset} purpose="contact" initialProfile={profile ?? editor.profile}
      defaults={{ firstName: '', lastName: '' }} telegramUserId={contact.telegramUserId} telegramUsername={null}
      onCancel={() => setEditor(null)}
      onSave={async (draft, changedFields) => {
        const owner = active.current;
        const patch: Partial<UserProfileDraft> = Object.fromEntries((changedFields ?? []).map(field => [field, draft[field]]));
        const saved = await repository.saveContactOverrides(contact.userId, contact.relationshipId, patch);
        if (!isCurrent(owner)) return;
        setSnapshot({ repository, key, data: saved, error: false });
        setEditor(null);
        setMessage({ repository, key, text: 'Переопределения сохранены на устройстве.', error: false });
      }} />
  </section>;
  const fields: Array<[string, string, UserProfileField?]> = profile ? [
    ['Имя', profile.firstName || 'Не указано', 'firstName'],
    ['Фамилия', profile.lastName || 'Не указана', 'lastName'],
    ['E-mail', profile.email || 'Не указан', 'email'],
    ['Телефон', profile.phone || 'Не указан', 'phone'],
    ['Telegram ID', contact.telegramUserId],
    ['Дата рождения', profile.birthDate || 'Не указана', 'birthDate'],
    ['Пол', profile.sex === 'male' ? 'муж' : profile.sex === 'female' ? 'жен' : 'не указан', 'sex'],
    ['Вес, кг', profile.weightKg === null ? 'Не указан' : String(profile.weightKg), 'weightKg'],
  ] : [];
  const age = profile ? ageFromBirthDate(profile.birthDate) : null;
  return <GlassSurface component="section" preset="modalTuned" optics={false} shape="auto"
    contentClassName="stack client-workspace-surface">
    <Text variant="title">Анкета пользователя</Text>
    <UserAvatarEditor contact={contact} editable={avatarEditing && data?.canEdit === true} />
    {data?.canEdit && !data.incomplete && !current?.error && (!profile || avatarEditing) ? <Button variant="secondary"
      onClick={() => setAvatarEditing(value => !value)}>{avatarEditing ? 'Готово' : 'Изменить аватар'}</Button> : null}
    {!repository ? <Text variant="body">Анкета пока недоступна.</Text>
      : !current ? <Text variant="body">Загрузка анкеты…</Text> : current.error
      ? <><Text variant="body" role="alert">Анкета недоступна по этой связи.</Text>
        <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Повторить</Button></>
      : data?.incomplete ? <Text variant="body">Переопределения ещё загружаются. Повторите позже.</Text>
      : !profile ? <><Text variant="body">{contact.displayName}</Text>
        <Text variant="headline">Telegram ID</Text><Text variant="body">{contact.telegramUserId}</Text>
        <Text variant="body">Анкета клиента ещё не опубликована.</Text></>
      : <>{fields.map(([label, value]) => <div className="stack" key={label}>
        <Text variant="headline">{label}</Text><Text variant="body">{value}</Text>
      </div>)}
        {data?.canEdit && repository ? <Button disabled={resetting}
          onClick={() => { setMessage(null); setEditor({ repository, key, profile }); }}>Изменить анкету</Button> : null}
        {age !== null ? <Text variant="body">Возраст: {age}</Text> : null}
        <Text variant="caption" tone="muted">Изменено: {new Date(profile.updatedAt).toLocaleString('ru-RU')}</Text>
      </>}
    {notice ? <Text variant="footnote" role={notice.error ? 'alert' : 'status'}>{notice.text}</Text> : null}
  </GlassSurface>;
}
