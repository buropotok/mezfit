import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createClientInvite,
  createCoachProgram,
  getCoachClients,
  type CoachClientListItem,
  type CreateCoachProgramOwner,
} from '../api';
import type { AppDestination, NavigationContext } from '../NavigationShell';
import { Avatar, Button, FloatingActionButton, List, ListItem, Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui';
import { ExerciseCatalog } from './ExerciseCatalog';
import { GlobalExerciseCatalog } from './GlobalExerciseCatalog';
import { ProgramsPage, type ProgramCreationDraft } from './ProgramsPage';

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
  calendar: { title: 'Календарь', text: 'Здесь появится сводный календарь тренировок всех клиентов.' },
  settings: { title: 'Настройки', text: 'Системные настройки будут добавляться отдельными задачами.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function displayName(client: CoachClientListItem): string {
  return [client.user.firstName, client.user.lastName].filter(Boolean).join(' ');
}

function AddClientIcon() {
  return (
    <svg className="add-client-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.14 0-7.5 2.24-7.5 5v1h11.1a6.5 6.5 0 0 1-.1-1.1c0-1.86.78-3.54 2.04-4.72A12.16 12.16 0 0 0 9.5 13Zm9.5 1v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2Z" fill="currentColor" />
    </svg>
  );
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
    <Tabs className="stack client-workspace" value={tab} onValueChange={(value) => setTab(value as ClientTab)}>
      <TabsList aria-label={`Разделы клиента ${name}`}>
        {tabs.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
      </TabsList>

      <TabsContent value="overview"><Placeholder title="Обзор" text="Здесь появятся последняя тренировка, следующая тренировка и быстрые действия тренера." /></TabsContent>
      <TabsContent value="program"><Placeholder title="Программа" text="Редактор назначенной программы будет следующим вертикальным срезом." /></TabsContent>
      <TabsContent value="exercises"><ExerciseCatalog initData={initData} clientUserId={client.user.id} /></TabsContent>
      <TabsContent value="calendar"><Placeholder title="Календарь" text="Плановые и завершённые тренировки клиента появятся после реализации WorkoutOccurrence." /></TabsContent>
      <TabsContent value="progress"><Placeholder title="Прогресс" text="Замеры, фотографии и производные показатели будут добавлены после тренировочного ядра." /></TabsContent>
      <TabsContent value="history"><Placeholder title="История" text="Хронологическая история WorkoutSession появится вместе с PLAN / FACT анализом." /></TabsContent>
    </Tabs>
  );
}

function ClientDirectory({
  clients,
  error = '',
  onRetry,
  onSelect,
  onAdd,
  busy = false,
}: {
  clients: CoachClientListItem[] | null;
  error?: string;
  onRetry?: () => void;
  onSelect: (client: CoachClientListItem) => void;
  onAdd?: () => void;
  busy?: boolean;
}) {
  return (
    <section className="client-directory-surface" aria-label="Список клиентов">
      <div className="client-directory-scroll">
        {error ? (
          <div className="empty-state directory-empty" role="alert">
            <strong>Не удалось загрузить клиентов</strong>
            <p>{error}</p>
            {onRetry ? <Button onClick={onRetry}>Повторить</Button> : null}
          </div>
        ) : clients === null ? <p className="directory-message">Загружаем клиентов…</p> : clients.length === 0 ? (
          <div className="empty-state directory-empty"><strong>Пока нет клиентов</strong><p>Создайте персональную ссылку и отправьте её клиенту в Telegram.</p></div>
        ) : (
          <List className="compact-client-list">
            {clients.map((client) => (
              <ListItem
                key={client.relationshipId}
                onClick={() => onSelect(client)}
                leading={<Avatar name={displayName(client)} src={client.user.photoUrl ?? undefined} />}
                title={displayName(client)}
                subtitle={client.user.username ? `@${client.user.username}` : 'Клиент Mezfit'}
              />
            ))}
          </List>
        )}
      </div>

      {onAdd ? (
        <FloatingActionButton label="Добавить клиента" onClick={onAdd} disabled={busy}>
          <AddClientIcon />
        </FloatingActionButton>
      ) : null}
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
  const [inviteCopyError, setInviteCopyError] = useState('');
  const [message, setMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [programDraft, setProgramDraft] = useState<ProgramCreationDraft | null>(null);
  const [selectingProgramClient, setSelectingProgramClient] = useState(false);
  const [programCreateBusy, setProgramCreateBusy] = useState(false);
  const [programCreateError, setProgramCreateError] = useState('');
  const [programRefreshKey, setProgramRefreshKey] = useState(0);
  const programClientRequestRef = useRef(0);

  const loadClients = useCallback(async () => {
    setClients(null);
    setMessage('');
    try {
      const { clients: next } = await getCoachClients(initData);
      setClients(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов');
    }
  }, [initData]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    programClientRequestRef.current += 1;
    if (destination !== 'clients' && destination !== 'programs' && selectedClient) setSelectedClient(null);
    if (destination !== 'programs') {
      setProgramDraft(null);
      setSelectingProgramClient(false);
      setProgramCreateError('');
    }
  }, [destination, selectedClient]);

  useEffect(() => {
    if (selectingProgramClient && destination === 'programs') {
      onNavigationContextChange({ title: 'Клиенты', onBack: () => setSelectingProgramClient(false) });
      return () => onNavigationContextChange(null);
    }

    if (!selectedClient) {
      if (destination !== 'exercises') onNavigationContextChange(null);
      return undefined;
    }

    onNavigationContextChange({
      title: displayName(selectedClient),
      onBack: () => setSelectedClient(null),
    });
    return () => onNavigationContextChange(null);
  }, [destination, selectedClient, selectingProgramClient, onNavigationContextChange]);

  if (selectedClient) {
    return <ClientWorkspace initData={initData} client={selectedClient} />;
  }

  if (destination === 'exercises') {
    return <GlobalExerciseCatalog initData={initData} onNavigationContextChange={onNavigationContextChange} />;
  }

  if (destination === 'programs') {
    if (selectingProgramClient) {
      return (
        <section className="coach-directory">
          <ClientDirectory
            clients={clients}
            error={message}
            onRetry={() => { void loadClients(); }}
            onSelect={(client) => {
              setProgramDraft((draft) => draft ? { ...draft, owner: { type: 'client', client } } : draft);
              setSelectingProgramClient(false);
            }}
          />
        </section>
      );
    }

    const selectProgramClient = async (userId: number) => {
      const requestId = programClientRequestRef.current + 1;
      programClientRequestRef.current = requestId;
      const cached = clients?.find((item) => item.user.id === userId);
      if (cached) {
        if (programClientRequestRef.current === requestId) setSelectedClient(cached);
        return;
      }

      const { clients: refreshedClients } = await getCoachClients(initData);
      if (programClientRequestRef.current !== requestId) return;
      setClients(refreshedClients);
      const client = refreshedClients.find((item) => item.user.id === userId);
      if (!client) throw new Error('Клиент больше не связан с тренером');
      setSelectedClient(client);
    };

    const saveProgram = async () => {
      if (!programDraft?.name.trim() || !programDraft.owner || programCreateBusy) return;
      const owner: CreateCoachProgramOwner = programDraft.owner.type === 'self'
        ? { type: 'self' }
        : { type: 'client', clientUserId: programDraft.owner.client.user.id };
      setProgramCreateBusy(true);
      setProgramCreateError('');
      try {
        await createCoachProgram(initData, programDraft.name.trim(), owner);
        setProgramDraft(null);
        setProgramRefreshKey((value) => value + 1);
      } catch (error) {
        setProgramCreateError(error instanceof Error ? error.message : 'Не удалось создать программу');
      } finally {
        setProgramCreateBusy(false);
      }
    };

    return (
      <ProgramsPage
        initData={initData}
        onSelectClient={selectProgramClient}
        creationDraft={programDraft}
        creationBusy={programCreateBusy}
        creationError={programCreateError}
        refreshKey={programRefreshKey}
        onOpenCreation={() => {
          setProgramCreateError('');
          setProgramDraft({ name: '', owner: null });
        }}
        onCancelCreation={() => {
          if (!programCreateBusy) {
            setProgramDraft(null);
            setProgramCreateError('');
          }
        }}
        onDraftChange={(draft) => {
          setProgramCreateError('');
          setProgramDraft(draft);
        }}
        onRequestClientSelection={() => setSelectingProgramClient(true)}
        onSaveCreation={() => { void saveProgram(); }}
      />
    );
  }

  if (destination !== 'clients') {
    const placeholder = coachPlaceholderCopy[destination] ?? { title: 'Раздел', text: 'Этот раздел будет реализован отдельной задачей.' };
    return <GlobalPlaceholder title={placeholder.title} text={placeholder.text} />;
  }

  const closeInvite = () => {
    setInviteUrl(null);
    setInviteCopyError('');
  };

  const createInvite = async () => {
    setBusy(true);
    setInviteError('');
    setInviteCopyError('');
    try {
      const result = await createClientInvite(initData);
      setInviteUrl(result.telegramUrl);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Не удалось создать приглашение');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    setInviteCopyError('');
    try {
      await navigator.clipboard.writeText(inviteUrl);
      closeInvite();
    } catch {
      setInviteCopyError('Не удалось скопировать автоматически — нажмите и удерживайте ссылку');
    }
  };

  return (
    <section className="coach-directory">
      <header className="coach-directory-header">
        <div>
          <div className="eyebrow">Тренер</div>
          <h2>Клиенты</h2>
        </div>
      </header>

      <ClientDirectory
        clients={clients}
        error={message}
        onRetry={() => { void loadClients(); }}
        onSelect={setSelectedClient}
        onAdd={() => { void createInvite(); }}
        busy={busy}
      />

      <Modal isOpen={Boolean(inviteUrl)} title="Пригласить клиента" onClose={closeInvite}>
        <p>Отправьте эту персональную ссылку клиенту в Telegram. Ссылка одноразовая и действует 30 дней.</p>
        <div className="link-box">{inviteUrl}</div>
        {inviteCopyError ? <p className="inline-message error-text invite-copy-error" role="alert">{inviteCopyError}</p> : null}
        <div className="button-row invite-modal-actions">
          <Button onClick={copyInvite}>Копировать ссылку</Button>
        </div>
      </Modal>

      {inviteError ? <p className="inline-message" role="alert">{inviteError}</p> : null}
    </section>
  );
}
