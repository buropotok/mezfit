import { useEffect, useState } from 'react';
import {
  createClientInvite,
  getCoachClients,
  type CoachClientListItem,
} from '../api';
import type { AppDestination, NavigationContext } from '../NavigationShell';
import { Avatar, Button } from '../ui';
import { ExerciseCatalog } from './ExerciseCatalog';
import { GlobalExerciseCatalog } from './GlobalExerciseCatalog';

type ClientTab = 'overview' | 'program' | 'exercises' | 'calendar' | 'progress' | 'history';

const tabs: Array<{ id: ClientTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'program', label: 'Программа' },
  { id: 'exercises', label: 'Упражнения' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'progress', label: 'Прогресс' },
  { id: 'history', label: 'История' },
];

const coachPlaceholderCopy: Partial<Record<AppDestination, { title: string; text: string }>> = {
  programs: { title: 'Программы', text: 'Здесь будет глобальный список программ тренера и быстрый переход к назначению клиенту.' },
  calendar: { title: 'Календарь', text: 'Здесь появится сводный календарь тренировок всех клиентов.' },
  settings: { title: 'Настройки', text: 'Системные настройки будут добавляться отдельными задачами.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

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

function GlobalPlaceholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="global-placeholder">
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function ClientWorkspace({ initData, client }: { initData: string; client: CoachClientListItem }) {
  const [tab, setTab] = useState<ClientTab>('overview');
  const name = displayName(client);

  return (
    <section className="stack client-workspace">
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

interface CoachShellProps {
  initData: string;
  destination: AppDestination;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function CoachShell({ initData, destination, onNavigationContextChange }: CoachShellProps) {
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

  useEffect(() => {
    if (destination !== 'clients' && selectedClient) setSelectedClient(null);
  }, [destination, selectedClient]);

  useEffect(() => {
    if (!selectedClient) {
      if (destination !== 'exercises') onNavigationContextChange(null);
      return;
    }

    onNavigationContextChange({
      title: displayName(selectedClient),
      onBack: () => setSelectedClient(null),
    });
    return () => onNavigationContextChange(null);
  }, [destination, selectedClient, onNavigationContextChange]);

  if (selectedClient) {
    return <ClientWorkspace initData={initData} client={selectedClient} />;
  }

  if (destination === 'exercises') {
    return <GlobalExerciseCatalog initData={initData} onNavigationContextChange={onNavigationContextChange} />;
  }

  if (destination !== 'clients') {
    const placeholder = coachPlaceholderCopy[destination] ?? { title: 'Раздел', text: 'Этот раздел будет реализован отдельной задачей.' };
    return <GlobalPlaceholder title={placeholder.title} text={placeholder.text} />;
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
    <section className="stack coach-directory">
      <header className="coach-directory-header">
        <div>
          <div className="eyebrow">Тренер</div>
          <h2>Клиенты</h2>
        </div>
        <Button className="primary-button" onClick={createInvite} disabled={busy}>{busy ? 'Создаём…' : '+ Клиент'}</Button>
      </header>

      <section className="client-directory-surface" aria-label="Список клиентов">
        {clients === null ? <p className="directory-message">Загружаем клиентов…</p> : clients.length === 0 ? (
          <div className="empty-state directory-empty"><strong>Пока нет клиентов</strong><p>Создайте персональную ссылку и отправьте её клиенту в Telegram.</p></div>
        ) : (
          <div className="client-list compact-client-list">
            {clients.map((client) => (
              <button className="client-row" key={client.relationshipId} type="button" onClick={() => setSelectedClient(client)}>
                <Avatar className="avatar" name={client.user.firstName} />
                <span><strong>{displayName(client)}</strong><small>{client.user.username ? `@${client.user.username}` : 'Клиент Mezfit'}</small></span>
                <span className="row-chevron" aria-hidden="true">›</span>
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
            <Button className="primary-button" onClick={copyInvite}>Копировать</Button>
            <Button variant="secondary" className="secondary-button" onClick={() => setInviteUrl(null)}>Закрыть</Button>
          </div>
        </section>
      ) : null}

      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}
