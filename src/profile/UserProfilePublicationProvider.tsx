import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { UserProfileRepository } from '../data/cloud/user-profile';
import { Badge, Button } from '../ui';

interface ProfileDelivery {
  label: string;
  color: 'gray' | 'yellow' | 'red' | 'green';
  error: string;
  retry: () => void;
}
const Context = createContext<ProfileDelivery | null>(null);

/** Account-scoped publication survives screen and role changes. Context holds status only. */
export function UserProfilePublicationProvider({ children }: { children: ReactNode }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new UserProfileRepository(cloud.db, cloud.actorUserId) : null, [cloud?.db, cloud?.actorUserId]);
  const [input, setInput] = useState<{ repository: UserProfileRepository; version: string | null } | null>(null);
  const [published, setPublished] = useState<typeof input>(null);
  const [confirmed, setConfirmed] = useState<typeof input>(null);
  const [failure, setFailure] = useState<{ repository: UserProfileRepository; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [check, setCheck] = useState(0);
  const current = input?.repository === repository ? input : null;
  const active = useRef({ repository, version: current?.version });
  const pushing = useRef<object | null>(null);
  const attemptedPush = useRef<{ repository: UserProfileRepository; version: string; retry: number } | null>(null);
  useLayoutEffect(() => { pushing.current = null; attemptedPush.current = null; }, [repository]);
  useLayoutEffect(() => {
    active.current = { repository, version: current?.version };
    return () => { active.current = { repository: null, version: undefined }; };
  }, [repository, current?.version]);
  useEffect(() => {
    if (!repository) return;
    const subscription = repository.observePublicationVersion(version => setInput({ repository, version }),
      () => setFailure({ repository, message: 'Не удалось прочитать данные анкеты для публикации.' }));
    return () => subscription.unsubscribe();
  }, [repository, retry]);
  useEffect(() => {
    if (!repository || !current) return;
    let alive = true;
    setFailure(null);
    void repository.publishOwn().then(version => {
      if (alive) setPublished({ repository, version });
    }).catch(() => {
      if (alive) setFailure({ repository, message: 'Не удалось опубликовать анкету для контактов. Личная анкета сохранена.' });
    });
    return () => { alive = false; };
  }, [repository, current?.version, retry]);

  const version = current?.version;
  const ready = published?.repository === repository && published.version === version;
  const synced = confirmed?.repository === repository && confirmed.version === version;
  useEffect(() => {
    if (!repository || !version || !ready || synced || cloud?.syncStatus !== 'synced' || pushing.current) return;
    if (attemptedPush.current?.repository === repository && attemptedPush.current.version === version
      && attemptedPush.current.retry === retry) return;
    attemptedPush.current = { repository, version, retry };
    const token = {};
    pushing.current = token;
    // Phase changes during this public push must not cancel its acknowledgement.
    void repository.confirmOwnSync(version).then(ok => {
      if (ok && active.current.repository === repository && active.current.version === version)
        setConfirmed({ repository, version });
    }).catch(() => {
      if (active.current.repository === repository && active.current.version === version)
        setFailure({ repository, message: 'Не удалось подтвердить отправку анкеты в Mezfit облако.' });
    }).finally(() => {
      if (pushing.current === token) pushing.current = null;
      if (active.current.repository === repository) setCheck(value => value + 1);
    });
  }, [repository, version, ready, synced, cloud?.syncStatus, retry, check]);
  const error = failure?.repository === repository ? failure.message : '';
  const label = error ? 'Ошибка' : !current ? 'Загрузка' : !version ? 'Не сохранена'
    : synced ? 'Синхронизирована' : cloud?.syncStatus === 'offline' ? 'Нет соединения'
    : cloud?.syncStatus === 'error' ? 'Ошибка' : 'В ожидании';
  const color = label === 'Синхронизирована' ? 'green' : label === 'Ошибка' ? 'red'
    : label === 'В ожидании' ? 'yellow' : 'gray';
  return <Context.Provider value={{ label, color, error, retry: () => { setFailure(null); setRetry(value => value + 1); } }}>
    {children}
  </Context.Provider>;
}

export function UserProfileSyncStatus() {
  const status = useContext(Context);
  return <span className="user-profile__sync" role="status" aria-label="Статус синхронизации анкеты">
    <Badge color={status?.color ?? 'gray'} textVariant="caption" title={status?.error || undefined}>
      {status?.label ?? 'Загрузка'}
    </Badge>
    {status?.error ? <Button variant="secondary" size="compact" onClick={status.retry}>Повторить</Button> : null}
  </span>;
}
