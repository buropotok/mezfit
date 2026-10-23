import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, Text } from '../ui';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CoachClientAvatarRepository } from '../data/cloud/coach-client-avatars';
import { prepareCoachClientAvatar } from '../media/coach-client-avatar';

function readableError(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.message === 'INVALID_AVATAR_FILE') return 'Выберите изображение размером до 20 МБ.';
    if (reason.message === 'AVATAR_FILE_UNREADABLE') return 'Не удалось открыть это изображение.';
    if (reason.message === 'AVATAR_TOO_COMPLEX') return 'Не удалось достаточно сжать изображение.';
  }
  return 'Не удалось сохранить фотографию. Попробуйте ещё раз.';
}

/** Only the current coach may create/remove their own private avatar override. */
export function CoachClientAvatarEditor({ client }: { client: CloudContact }) {
  const connections = useCloudConnections();
  const repository = useMemo(() =>
    connections ? new CoachClientAvatarRepository(connections.db, connections.actorUserId) : null,
  [connections?.db, connections?.actorUserId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const save = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !repository || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { small, large } = await prepareCoachClientAvatar(file);
      if (!activeRef.current) return;
      await repository.save(client, small, large);
      if (activeRef.current) setMessage('Фотография сохранена локально и ожидает синхронизации.');
    } catch (reason) {
      if (activeRef.current) setError(readableError(reason));
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };

  const remove = async () => {
    if (!repository || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await repository.remove(client);
      if (activeRef.current) setMessage('Личная фотография удалена. Используется фото клиента.');
    } catch (reason) {
      if (activeRef.current) setError(readableError(reason));
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };

  return <section className="card" aria-label="Фотография клиента">
    <Text variant="headline" role="heading" aria-level={3}>Фотография клиента</Text>
    <CloudContactAvatar contact={client} variant="large" />
    <Text variant="footnote" tone="muted">
      Только для вас: фотография синхронизируется между вашими устройствами и не заменяет профиль клиента.
    </Text>
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
      className="sr-only"
      aria-label="Выбрать фотографию клиента"
      onChange={(event) => { void save(event); }}
      disabled={busy || !repository}
    />
    <Button onClick={() => inputRef.current?.click()} disabled={busy || !repository}>
      {busy ? 'Обработка фотографии…' : 'Загрузить своё фото'}
    </Button>
    {client.coachAvatarVersion ? <Button onClick={() => { void remove(); }} disabled={busy || !repository}>Вернуть фото клиента</Button> : null}
    {message ? <Text variant="footnote" role="status">{message}</Text> : null}
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
  </section>;
}
