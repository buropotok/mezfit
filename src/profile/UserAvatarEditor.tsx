import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserAvatarRepository, type UserAvatarSnapshot } from '../data/cloud/user-avatar';
import { useCloudContactAvatarUrl } from '../contacts/CloudContactAvatar';
import { compressUserAvatar } from '../media/telegram-avatar-compress';
import { Avatar } from '../ui/primitives';
import { Button, Text } from '../ui';

/** Uses the normal avatar source; mutations remain local and retryable. */
export function UserAvatarEditor({ contact, editable = true, fallbackSrc }: { contact?: CloudContact; editable?: boolean; fallbackSrc?: string | null }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud?.db && cloud.actorUserId
    ? new UserAvatarRepository(cloud.db, cloud.actorUserId) : null, [cloud?.db, cloud?.actorUserId]);
  const own = cloud?.selfAvatars?.find(item => item.userId === cloud.actorUserId);
  const subject = contact ?? own ?? (cloud ? { userId: cloud.actorUserId, relationshipId: cloud.actorUserId,
    telegramUserId: cloud.actorUserId.slice(3), displayName: 'Мой аватар' } : null);
  const src = useCloudContactAvatarUrl(subject, 'large');
  const key = contact ? contact.userId + ':' + contact.relationshipId : cloud?.actorUserId;
  const [snapshot, setSnapshot] = useState<{ repository: UserAvatarRepository; key: string | undefined; data: UserAvatarSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<object | null>(null);
  const running = useRef(false);
  useLayoutEffect(() => {
    const visit = {};
    active.current = visit;
    running.current = false;
    setBusy(false); setMessage(''); setSnapshot(null);
    return () => { active.current = null; };
  }, [repository, key]);
  useEffect(() => {
    if (!repository) return;
    const visit = active.current;
    let alive = true;
    const subscription = repository.observe(contact?.userId ?? repository.actorUserId,
      contact?.relationshipId ?? repository.actorUserId,
      data => { if (alive && active.current === visit) {
        setSnapshot({ repository, key, data });
        setMessage(previous => previous === 'Не удалось загрузить аватар.' ? '' : previous);
      } },
      () => { if (alive && active.current === visit) { setSnapshot(null); setMessage('Не удалось загрузить аватар.'); } });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [repository, key, retry, cloud?.avatarLoadRevision]);
  const current = snapshot?.repository === repository && snapshot?.key === key ? snapshot.data : null;
  const perform = async (action: 'upload' | 'remove' | 'reset', file?: File) => {
    if (!repository || running.current || !editable) return;
    const visit = active.current;
    running.current = true; setBusy(true); setMessage('');
    try {
      const images = file ? await compressUserAvatar(file) : null;
      if (active.current !== visit) return;
      if (action === 'reset' && contact) await repository.reset(contact.userId, contact.relationshipId);
      else await repository.save(images, contact ? { userId: contact.userId, realmId: contact.relationshipId } : undefined);
      if (active.current === visit) setMessage('Аватар сохранён на устройстве.');
    } catch (reason) {
      if (active.current === visit) setMessage(reason instanceof Error && /[А-Яа-яЁё]/.test(reason.message)
        ? reason.message : 'Не удалось сохранить аватар. Повторите действие.');
    } finally {
      if (active.current === visit) { running.current = false; setBusy(false); }
    }
  };
  return <section className="stack" aria-label="Аватар пользователя">
    <Text variant="headline">Аватар</Text>
    <Avatar name={subject?.displayName ?? 'Мой аватар'} src={src ?? fallbackSrc ?? undefined} />
    {editable && repository ? <>
      <input hidden ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform('upload', file); }} />
      <Button disabled={busy || !current || current.incomplete} onClick={() => input.current?.click()}>{busy ? 'Сохранение…' : 'Загрузить аватар'}</Button>
      {current?.value?.small ? <Button variant="secondary" disabled={busy || current.incomplete}
        onClick={() => { void perform('remove'); }}>Удалить аватар</Button> : null}
      {contact && current?.overridden ? <>
        <Text variant="caption" tone="muted">Переопределено в этой связи</Text>
        <Button variant="secondary" disabled={busy || current.incomplete} onClick={() => { void perform('reset'); }}>Сбросить аватар</Button>
      </> : null}
      {!current || current.incomplete ? <><Text variant="body">Аватар ещё не загружен.</Text>
        <Button variant="secondary" disabled={busy} onClick={() => setRetry(value => value + 1)}>Повторить загрузку аватара</Button></> : null}
      {message ? <Text variant="footnote" role="status">{message}</Text> : null}
    </> : null}
  </section>;
}
