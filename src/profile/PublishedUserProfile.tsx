import { useEffect, useMemo, useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserProfileRepository, ageFromBirthDate, type UserProfile } from '../data/cloud/user-profile';
import { GlassSurface, Text } from '../ui';

/** Reads only the existing relationship realm; private peer data is never queried. */
export function PublishedUserProfile({ contact }: { contact: CloudContact }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? new UserProfileRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [snapshot, setSnapshot] = useState<{ key: string; profile: UserProfile | null; error: boolean } | null>(null);
  const key = cloud?.actorUserId + ':' + contact.relationshipId + ':' + contact.userId;
  useEffect(() => {
    if (!repository) return;
    let active = true;
    const subscription = repository.observePublished(contact.userId, contact.relationshipId,
      profile => { if (active) setSnapshot({ key, profile, error: false }); },
      () => { if (active) setSnapshot({ key, profile: null, error: true }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, contact.userId, contact.relationshipId, key]);
  const current = snapshot?.key === key ? snapshot : null;
  const profile = current?.profile;
  const fields = profile ? [
    ['Имя', profile.firstName || 'Не указано'],
    ['Фамилия', profile.lastName || 'Не указана'],
    ['E-mail', profile.email || 'Не указан'],
    ['Телефон', profile.phone || 'Не указан'],
    ['Telegram ID', contact.telegramUserId],
    ['Дата рождения', profile.birthDate || 'Не указана'],
    ['Пол', profile.sex === 'male' ? 'муж' : profile.sex === 'female' ? 'жен' : 'не указан'],
    ['Вес, кг', profile.weightKg === null ? 'Не указан' : String(profile.weightKg)],
  ] : [];
  const age = profile ? ageFromBirthDate(profile.birthDate) : null;
  return <GlassSurface component="section" preset="modalTuned" optics={false} shape="auto"
    contentClassName="stack client-workspace-surface">
    <Text variant="title">Анкета пользователя</Text>
    {!current ? <Text variant="body">Загрузка анкеты…</Text> : current.error
      ? <Text variant="body" role="alert">Анкета недоступна по этой связи.</Text>
      : !profile ? <><Text variant="body">{contact.displayName}</Text>
        <Text variant="headline">Telegram ID</Text><Text variant="body">{contact.telegramUserId}</Text>
        <Text variant="body">Анкета ещё не опубликована.</Text></>
      : <>{fields.map(([label, value]) => <div className="stack" key={label}>
        <Text variant="headline">{label}</Text><Text variant="body">{value}</Text>
      </div>)}
        {age !== null ? <Text variant="body">Возраст: {age}</Text> : null}
        <Text variant="caption" tone="muted">Изменено: {new Date(profile.updatedAt).toLocaleString('ru-RU')}</Text>
      </>}
  </GlassSurface>;
}
