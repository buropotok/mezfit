import { useEffect, useState } from 'react';
import {
  createClientInvite,
  getCoachClients,
  type CoachClientListItem,
} from '../api';
import { ExerciseCatalog } from './ExerciseCatalog';

type ClientTab = 'overview' | 'program' | 'exercises' | 'calendar' | 'progress' | 'history';

const tabs: Array<{ id: ClientTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'program', label: 'Программа' },
  { id: 'exercises', label: 'Упражнения' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'progress', label: 'Прогресс' },
  { id: 'history', label: 'История' },
];

function displayName(client: CoachClientListItem): string {
  return [client.user.firstName, client.user.lastName].filter(Boolean).join(' ');
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="card">
      <div className="eyebrow">Клиент</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function ClientWorkspace({ initData, client, onBack }: { initData: string; client: CoachClientListItem; onBack: () => void }) {
  const [tab, setTab] = useState<ClientTab>('overview');
  const name = displayName(client);

  return (
    <section className="stack">
      <section className="client-workspace-header">
        <button className="back-button" type="button" onClick={onBack}>← Клиенты</button>
        <div><div className="eyebrow">Клиент</div><h2>{name}</h2></div>
      </section>
      <nav className="client-tabs" aria-label={`Разделы клиента ${name}`}>
        {tabs.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </nav>

      {tab === 'overview' ? <Placeholder title="Обзор" text="Здесь появятся последняя тренировка, следующая тренировка и быстрые действия тренера." /> : null}
      {tab === 'program' ? <Placeholder title="Программа" text="Редактор назначенной программы будет следующим вертикальным срезом." /> : null}
      {tab === 'exercises' ? <ExerciseCatalog initData={initData} clientUserId={client.user.id} /> : null}
      {tab === 'calendar' ? <Placeholder title="Календарь" text="Плановые и завершённые тренировки клиента появятся после реализации WorkoutOccurrence." /> : null}
      {tab === 'progress' ? <Placeholder title="Прогресс" text="Замеры, фотографии и производные показатели будут добавлены после тренировочного ядра." /> : null}
      {tab === 'history' ? <Placeholder title="История" text="Хронологическая история WorkoutSession появится вместе с PLAN / FACT анализом." /> : null}
    </section>
  );
}

export function CoachShell({ initData }: { initData: string }) {
  const [clients, setClients] = useState<CoachClientListItem[] | null>(null);
  const [selectedClient, setSelectedClient] = useState<CoachClientListItem | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCoachClients(initData)
      .then(({ clients: next }) => {
        if (!cancelled) setClients(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов');
      });
    return () => { cancelled = true; };
  }, [initData]);

  if (selectedClient) {
    return <ClientWorkspace initData={initData} client={selectedClient} onBack={() => setSelectedClient(null)} />;
  }

  const createInvite = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await createClientInvite(initData);
      setInviteUrl(result.telegramUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать приглашение');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage('Ссылка скопирована');
    } catch {
      setMessage('Не удалось скопировать автоматически — нажмите и удерживайте ссылку');
    }
  };

  return (
    <section className="stack">
      <section className="card">
        <div className="section-heading">
          <div><div className="eyebrow">Coach mode</div><h2>Клиенты</h2></div>
          <button className="primary-button" onClick={createInvite} disabled={busy}>{busy ? 'Создаём…' : '+ Клиент'}</button>
        </div>

        {clients === null ? <p>Загружаем клиентов…</p> : clients.length === 0 ? (
          <div className="empty-state"><strong>Пока нет клиентов</strong><p>Создайте персональную ссылку и отправьте её клиенту в Telegram.</p></div>
        ) : (
          <div className="client-list">
            {clients.map((client) => (
              <button className="client-row" key={client.relationshipId} type="button" onClick={() => setSelectedClient(client)}>
                <span className="avatar">{client.user.firstName.slice(0, 1).toUpperCase()}</span>
                <span><strong>{displayName(client)}</strong><small>{client.user.username ? `@${client.user.username}` : 'Клиент Mezfit'}</small></span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {inviteUrl ? (
        <section className="card invite-card">
          <div className="eyebrow">Приглашение</div>
          <h2>Отправьте ссылку клиенту</h2>
          <p>Ссылка одноразовая и действует 30 дней. После подтверждения клиент автоматически появится в вашем списке.</p>
          <div className="link-box">{inviteUrl}</div>
          <div className="button-row">
            <button className="primary-button" onClick={copyInvite}>Копировать</button>
            <button className="secondary-button" onClick={() => setInviteUrl(null)}>Закрыть</button>
          </div>
        </section>
      ) : null}

      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}
