import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Button } from 'konsta/react';
import { diagnoseCloudContactProfileSync, getMe, type CloudAvatarSyncStatus } from '../api';
import { Avatar, Text } from '../ui';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { deriveCloudContacts, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { loadContactAvatar, type AvatarTraceStage } from '../data/cloud/contact-avatar-cache';

const stageNames: Record<AvatarTraceStage, string> = {
  'invalid-reference': 'Неверные метаданные изображения',
  'reading-dexie': 'Чтение изображения из Dexie Cloud (IndexedDB)',
  'profile-not-found': 'В синхронизированном профиле нет фотографии',
  'permission-version-changed': 'Версия аватара в профиле изменилась',
  'blob-validated': 'Изображение прочитано из Dexie Cloud',
  'indexeddb-error': 'Ошибка чтения локальной Dexie Cloud',

};

type ProbeState = 'idle' | 'pending' | 'ok' | 'failed';

const ownAvatarStages: Record<CloudAvatarSyncStatus, string> = {
  'no-relationship': 'Нет подтверждённой связи тренер–клиент для сохранения фотографии',
  'stale-session': 'Telegram передал более старую сессию, чем сохранена в облаке',
  'telegram-unavailable': 'Не удалось получить сведения о фотографии из Telegram',
  'no-photo': 'Telegram сообщает, что доступной фотографии нет',
  unchanged: 'Telegram возвращает уже сохранённую версию фотографии',
  'download-failed': 'Не удалось скачать новую фотографию из Telegram',
  'transform-failed': 'Не удалось обработать новую фотографию',
  'upload-failed': 'Не удалось записать новую фотографию в Dexie Cloud',
  partial: 'Сохранена только часть вариантов; повторите проверку',
  updated: 'Оба варианта фотографии обработаны и переданы в Dexie Cloud',
};

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
 * On-demand diagnostic: the owner's explicit check may refresh their own
 * authenticated relationship profile through the Worker. Peer reads remain
 * local/read-only. No private IDs, token, blob data or URLs are printed.
 */
export function CloudAvatarDiagnostic({ initData }: { initData: string }) {
  const [telegramUserId, setTelegramUserId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CloudContact[]>([]);
  const [stage, setStage] = useState('Чтение локальных профилей');
  const [trace, setTrace] = useState<AvatarTraceStage[]>([]);
  const [result, setResult] = useState<ProbeState>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ownAvatarStage, setOwnAvatarStage] = useState<string | null>(null);
  const [ownAvatarPending, setOwnAvatarPending] = useState(false);
  const mounted = useRef(false);
  const urlRef = useRef<string | null>(null);
  const dbRef = useRef<MezfitCloudDatabase | null>(null);

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
        dbRef.current = db;
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
      dbRef.current = null;
      db?.close({ disableAutoOpen: false });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [initData]);

  const checkOwnAvatar = async () => {
    if (ownAvatarPending) return;
    setOwnAvatarPending(true);
    setOwnAvatarStage(null);
    try {
      const response = await diagnoseCloudContactProfileSync(initData);
      if (mounted.current) {
        setOwnAvatarStage(ownAvatarStages[response.avatarStatus]);
        if (response.changed) {
          void dbRef.current?.cloud.sync({ purpose: 'pull', wait: false }).catch(() => {});
        }
      }
    } catch {
      if (mounted.current) setOwnAvatarStage('Ошибка запроса Worker или Dexie Cloud; обновление не подтверждено');
    } finally {
      if (mounted.current) setOwnAvatarPending(false);
    }
  };

  const selected = contacts.find((contact) => contact.avatarVersion) ?? null;
  const withAvatar = contacts.filter((contact) => contact.avatarVersion).length;

  const check = async () => {
    if (!dbRef.current || !selected || result === 'pending') return;
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
      const blob = await loadContactAvatar(dbRef.current, selected, push);
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
        URL.revokeObjectURL(url);
        urlRef.current = null;
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
      <Button onClick={() => { void checkOwnAvatar(); }} disabled={!telegramUserId || ownAvatarPending}>
        {ownAvatarPending ? 'Проверяем собственный Telegram-аватар…' : 'Проверить обновление моего Telegram-аватара'}
      </Button>
      {ownAvatarStage && <p role="status"><Text variant="body">{ownAvatarStage}</Text></p>}
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
