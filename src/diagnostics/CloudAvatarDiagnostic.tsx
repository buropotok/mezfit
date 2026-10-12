import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Button } from 'konsta/react';
import { getMe } from '../api';
import { Avatar, Text } from '../ui';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { deriveCloudContacts, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { loadContactAvatar, type AvatarTraceStage } from '../data/cloud/contact-avatar-cache';

const stageNames: Record<AvatarTraceStage, string> = {
  'invalid-reference': 'Неверные метаданные изображения',
  'waiting-for-download': 'Ожидаем уже начатую загрузку',
  'indexeddb-reading': 'Чтение локального кэша',
  'permission-not-found': 'Нет локального разрешения для аватара',
  'permission-version-changed': 'Локальная версия отличается от облачной',
  'cache-hit': 'Фотография найдена в IndexedDB',
  'requesting-worker': 'Запрос фотографии через Worker',
  'http-accepted': 'Worker: HTTP 200',
  'mime-accepted': 'Проверка типа и размера ответа пройдена',
  'blob-validated': 'Blob прочитан и проверен',
  'worker-request-failed': 'Ошибка запроса, проверки HTTP или Blob',
  'indexeddb-writing': 'Сохранение в IndexedDB',
  'cache-saved': 'Blob получен из кэша или сохранён',
  'cache-write-skipped': 'Запись отменена: доступ или версия изменились',
  'indexeddb-error': 'Ошибка чтения или записи IndexedDB',
};

type ProbeState = 'idle' | 'pending' | 'ok' | 'failed';

async function decodeImage(url: string): Promise<boolean> {
  // Exercise the WebView's native decoder without reading another user's DOM.
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/**
 * On-demand read-only diagnostic for the actual client avatar pipeline.
 * Never renders names, IDs, URLs, initData, raw errors or photo bytes as text.
 * It never creates cloud data or resets browser storage.
 */
export function CloudAvatarDiagnostic({ initData }: { initData: string }) {
  const [telegramUserId, setTelegramUserId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CloudContact[]>([]);
  const [stage, setStage] = useState('Чтение локальных профилей');
  const [trace, setTrace] = useState<AvatarTraceStage[]>([]);
  const [result, setResult] = useState<ProbeState>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const mounted = useRef(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let db: MezfitCloudDatabase | undefined;
    let subscription: { unsubscribe(): void } | undefined;

    void (async () => {
      try {
        const me = await getMe(initData);
        if (!active) return;
        const id = me.user.telegramUserId;
        if (!/^[1-9][0-9]*$/.test(id)) throw new Error('INVALID_ACCOUNT');
        db = createCloudDatabase(id, initData);
        const cloudDb = db;
        await cloudDb.open();
        if (!active) return;
        setTelegramUserId(id);

        subscription = liveQuery(async () => {
          const [realms, members, profiles] = await Promise.all([
            cloudDb.realms.toArray(),
            cloudDb.members.toArray(),
            cloudDb.contactProfiles.toArray(),
          ]);
          const found = await deriveCloudContacts('tg:' + id, realms, members, profiles);
          return [...found.clients, ...found.coaches];
        }).subscribe({
          next: (found) => {
            if (!active) return;
            setContacts(found);
            setStage('Контакты прочитаны из локальной Dexie Cloud');
          },
          error: () => { if (active) setStage('Ошибка чтения локальных контактов'); },
        });
        void cloudDb.cloud.sync({ purpose: 'pull', wait: false }).catch(() => {
          if (active) setStage('Не удалось запустить облачное обновление');
        });
      } catch {
        if (active) setStage('Ошибка проверки аккаунта или открытия Dexie Cloud');
      }
    })();

    return () => {
      active = false;
      mounted.current = false;
      subscription?.unsubscribe();
      db?.close({ disableAutoOpen: false });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [initData]);

  const selected = contacts.find((contact) => contact.avatarVersion) ?? null;
  const withAvatar = contacts.filter((contact) => contact.avatarVersion).length;

  const check = async () => {
    if (!telegramUserId || !selected || result === 'pending') return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setImageUrl(null);
    setTrace([]);
    setResult('pending');
    setStage('Запускаем проверку');

    const push = (step: AvatarTraceStage) => {
      if (!mounted.current) return;
      setTrace((current) => [...current, step].slice(-12));
      setStage(stageNames[step]);
    };

    try {
      const blob = await loadContactAvatar(telegramUserId, initData, selected, push);
      if (!mounted.current) return;
      if (!blob) {
        setResult('failed');
        return;
      }
      setStage('Проверка blob URL и декодирования в WebView');
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const decoded = await decodeImage(url);
      if (!mounted.current) return;
      if (!decoded) {
        setStage('WebView не смог декодировать изображение');
        setResult('failed');
        return;
      }
      setImageUrl(url);
      setStage('Изображение декодировано; передано в UIkit Avatar');
      setResult('ok');
    } catch {
      if (mounted.current) {
        setStage('Ошибка создания blob URL или декодирования изображения');
        setResult('failed');
      }
    }
  };

  return (
    <section aria-label="Диагностика аватаров">
      <Text variant="headline" role="heading" aria-level={2}>Диагностика аватаров</Text>
      <p><Text variant="body">Найдено контактов: {contacts.length}</Text></p>
      <p><Text variant="body">С версией аватара: {withAvatar}</Text></p>
      <Button onClick={() => { void check(); }} disabled={!selected || !telegramUserId || result === 'pending'}>
        {result === 'pending' ? 'Проверяем аватар…' : 'Проверить загрузку аватара'}
      </Button>
      <p role="status" aria-live="polite"><Text variant="body">Этап: {stage}</Text></p>
      <p><Text variant="body">Результат: {result === 'ok' ? 'успешно' : result === 'failed' ? 'ошибка' : result === 'pending' ? 'проверяем' : 'ожидает проверки'}</Text></p>
      {trace.length > 0
        ? <ol>{trace.map((step, index) => <li key={index}><Text variant="footnote">{stageNames[step]}</Text></li>)}</ol>
        : null}
      {imageUrl && result === 'ok' ? <Avatar name="Контакт" src={imageUrl} /> : null}
      <p><Text variant="footnote" tone="muted">Отображаются только этапы и количества. Telegram ID, токены, URL и содержимое фотографий не выводятся. Данные облака не изменяются.</Text></p>
    </section>
  );
}
