import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createClientInvite,
  createCoachProgram,
  type ProgramListItem,
} from '../api';
import { useNavigationBackTransition, useNavigationFloatingAction, type AppDestination, type NavigationContext } from '../NavigationShell';
import { Button, List, ListItem, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { GlassSurface } from '../ui/GlassSurface';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';
import { CloudContactAvatar, useCloudContactAvatarUrl } from '../contacts/CloudContactAvatar';
import { CloudContactsList } from '../contacts/CloudContactsList';
import { ClientPerformedExercisesPage } from './ClientPerformedExercisesPage';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_ASSIGNED_PROGRAMS_ENABLED } from '../data/cloud/pilot-activation';
import { CoachExercises } from '../exercises/CoachExercises';
import { ProgramDetailsPage } from './ProgramDetailsPage';
import { CloudProgramsPage } from '../program/CloudProgramsPage';
import type { ProgramActor } from '../program/ProgramSummary';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { CLOUD_PROGRAM_MANAGEMENT_ENABLED } from '../data/cloud/program-management-activation';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { TodayPage } from '../schedule/TodayPage';
import { ProgramsPage, type ProgramCreationDraft } from './ProgramsPage';

type ClientTab = 'overview' | 'program' | 'exercises' | 'calendar' | 'progress' | 'history';

const tabs: ReadonlyArray<{ value: ClientTab; label: string }> = [
  { value: 'overview', label: 'Обзор' },
  { value: 'program', label: 'Программа' },
  { value: 'exercises', label: 'Упражнения' },
  { value: 'calendar', label: 'Календарь' },
  { value: 'progress', label: 'Прогресс' },
  { value: 'history', label: 'История' },
];

const clientPlaceholderCopy: Record<Exclude<ClientTab, 'program' | 'exercises'>, { title: string; text: string }> = {
  overview: { title: 'Обзор', text: 'Здесь появятся последняя тренировка, следующая тренировка и быстрые действия тренера.' },
  calendar: { title: 'Календарь', text: 'Плановые и завершённые тренировки клиента появятся после реализации WorkoutOccurrence.' },
  progress: { title: 'Прогресс', text: 'Замеры, фотографии и производные показатели будут добавлены после тренировочного ядра.' },
  history: { title: 'История', text: 'Хронологическая история WorkoutSession появится вместе с PLAN / FACT анализом.' },
};

const coachPlaceholderCopy: Partial<Record<AppDestination, { title: string; text: string }>> = {
  analytics: { title: 'Аналитика', text: 'Здесь появятся аналитика клиентов, тренировок и нагрузки.' },
  calendar: { title: 'Календарь', text: 'Здесь появится сводный календарь тренировок всех клиентов.' },
  settings: { title: 'Настройки', text: 'Системные настройки будут добавляться отдельными задачами.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function displayName(client: CloudContact): string {
  return client.displayName;
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}
      shape={{ radius: 16 }} wrapContent={false} className="client-workspace-surface">
      <Text variant="caption" tone="muted">Клиент</Text>
      <Text variant="title">{title}</Text>
      <Text variant="body" tone="muted">{text}</Text>
    </GlassSurface>
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

function ClientWorkspace({ client, tab, onTabChange, programContent, exercisesContent }: {
  client: CloudContact;
  tab: ClientTab;
  onTabChange: (tab: ClientTab) => void;
  programContent?: ReactNode;
  exercisesContent?: ReactNode;
}) {
  const name = displayName(client);
  const content = tab === 'program' || tab === 'exercises' ? null : clientPlaceholderCopy[tab];

  return (
    <div className="stack client-workspace">
      <div className="client-workspace-tabs" role="group" aria-label={`Разделы клиента ${name}`}>
        <LiquidGlassTextOnly tabs={tabs} value={tab} hidden={false} fullWidth
          onValueChange={(value) => {
            if (tabs.some((item) => item.value === value)) onTabChange(value as ClientTab);
          }} />
      </div>

      {tab === 'program' ? programContent
        : tab === 'exercises' ? exercisesContent
          : content ? <Placeholder title={content.title} text={content.text} /> : null}
    </div>
  );
}

function ClientDirectory({
  clients,
  error = '',
  onRetry,
  onSelect,
  onAdd,
  busy = false,
  presentation = 'selection',
}: {
  clients: CloudContact[] | null;
  error?: string;
  onRetry?: () => void;
  onSelect: (client: CloudContact) => void;
  onAdd?: () => void;
  busy?: boolean;
  presentation?: 'selection' | 'contacts';
}) {
  const floatingAction = useMemo(() => onAdd ? {
    label: 'Добавить клиента',
    onClick: onAdd,
    disabled: busy,
    icon: 'user-plus' as const,
  } : null, [onAdd, busy]);
  useNavigationFloatingAction('clients', floatingAction);

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
        ) : presentation === 'contacts' ? (
          <CloudContactsList contacts={clients} onSelect={onSelect} />
        ) : (
          <List className="compact-client-list">
            {clients.map((client) => (
              <ListItem
                key={client.relationshipId}
                onClick={() => onSelect(client)}
                leading={<CloudContactAvatar contact={client} />}
                title={displayName(client)}
              />
            ))}
          </List>
        )}
      </div>

    </section>
  );
}

interface CoachShellProps {
  actor?: ProgramActor;
  initData: string;
  destination: AppDestination;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function CoachShell({ initData, actor, destination, onNavigationContextChange }: CoachShellProps) {
  const requestBackTransition = useNavigationBackTransition();
  const cloudPrograms = useAssignedPrograms();
  const cloudConnections = useCloudConnections();
  const programRepository = useMemo(() => cloudConnections
    ? new ProgramManagementRepository(cloudConnections.db, cloudConnections.actorUserId)
    : null, [cloudConnections?.db, cloudConnections?.actorUserId]);
  const clients = cloudConnections?.status === 'loading' ? null : cloudConnections?.clients ?? null;
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const selectedClient = clients?.find((client) => client.userId === selectedClientId) ?? null;
  const [clientTab, setClientTab] = useState<ClientTab>('overview');
  const [clientSelectedProgram, setClientSelectedProgram] = useState<CloudTrainingPlanRow | null>(null);
  const [clientProgramDetailNavigation, setClientProgramDetailNavigation] = useState<NavigationContext | null>(null);
  const selectedClientProgram = clientSelectedProgram && selectedClient
    && clientSelectedProgram.clientUserId === selectedClient.userId
    && clientSelectedProgram.realmId === selectedClient.relationshipId ? clientSelectedProgram : null;
  const selectedClientAvatarUrl = useCloudContactAvatarUrl(selectedClient);
  const [selectedProgram, setSelectedProgram] = useState<ProgramListItem | null>(null);
  const [programDetailNavigation, setProgramDetailNavigation] = useState<NavigationContext | null>(null);
  const [selectedCloudProgram, setSelectedCloudProgram] = useState<CloudTrainingPlanRow | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopyError, setInviteCopyError] = useState('');
  const message = cloudConnections?.status === 'error' ? cloudConnections.error : '';
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [programDraft, setProgramDraft] = useState<ProgramCreationDraft | null>(null);
  const [selectingProgramClient, setSelectingProgramClient] = useState(false);
  const [programCreateBusy, setProgramCreateBusy] = useState(false);
  const [programCreateError, setProgramCreateError] = useState('');
  const [programRefreshKey, setProgramRefreshKey] = useState(0);

  const loadClients = useCallback(() => {
    void cloudConnections?.refresh().catch(() => undefined);
  }, [cloudConnections]);

  const createInvite = useCallback(async () => {
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
  }, [initData]);

  const openProgramCreation = useCallback(() => {
    setProgramCreateError('');
    setProgramDraft({ name: '', owner: null });
  }, []);

  useEffect(() => {
    if (destination !== 'clients' && destination !== 'programs' && selectedClientId) setSelectedClientId(null);
    if (destination !== 'programs') {
      setSelectedProgram(null);
      setSelectedCloudProgram(null);
      setProgramDraft(null);
      setSelectingProgramClient(false);
      setProgramCreateError('');
    }
  }, [destination, selectedClientId]);

  useEffect(() => {
    if (selectingProgramClient && destination === 'programs') {
      onNavigationContextChange({ title: 'Клиенты', scrollKey: 'program-client-selection', onBack: () => setSelectingProgramClient(false) });
      return () => onNavigationContextChange(null);
    }

    if (selectedCloudProgram && destination === 'programs') {
      onNavigationContextChange(programDetailNavigation ?? { title: 'Детали программы', scrollKey: `cloud-plan:${selectedCloudProgram.id}`, onBack: () => setSelectedCloudProgram(null) });
      return () => onNavigationContextChange(null);
    }

    if (selectedProgram && destination === 'programs') {
      onNavigationContextChange({ title: 'Детали программы', scrollKey: `program:${selectedProgram.id}`, onBack: () => setSelectedProgram(null) });
      return () => onNavigationContextChange(null);
    }

    if (!selectedClient) {
      if (destination !== 'exercises' && destination !== 'today') onNavigationContextChange(null);
      return undefined;
    }

    if (selectedClientProgram && destination === 'clients') {
      onNavigationContextChange(clientProgramDetailNavigation ?? {
        title: 'Детали программы',
        scrollKey: `cloud-plan:${selectedClientProgram.id}`,
        onBack: () => {
          setClientSelectedProgram(null);
          setClientProgramDetailNavigation(null);
        },
      });
      return () => onNavigationContextChange(null);
    }

    const selectedClientName = displayName(selectedClient);
    onNavigationContextChange({
      title: selectedClientName,
      scrollKey: `client:${selectedClient.userId}`,
      identity: {
        title: selectedClientName,
        avatar: {
          name: selectedClientName,
          src: selectedClientAvatarUrl,
        },
      },
      onBack: () => setSelectedClientId(null),
    });
    return () => onNavigationContextChange(null);
  }, [programDetailNavigation, clientProgramDetailNavigation, destination, selectedClient, selectedClientProgram, selectedClientAvatarUrl, selectedProgram, selectedCloudProgram, selectingProgramClient, onNavigationContextChange]);

  if (selectedClient) {
    if (selectedClientProgram && destination === 'clients' && programRepository) {
      return <CloudProgramDetailsPage key={selectedClientProgram.id}
        onNavigationContextChange={setClientProgramDetailNavigation}
        actor={actor} viewerRole="coach" repository={programRepository} planId={selectedClientProgram.id}
        cloudStatus={cloudConnections?.status ?? 'loading'}
        cloudError={cloudConnections?.error ?? ''}
        syncStatus={cloudConnections?.syncStatus ?? 'pending'}
        syncError={cloudConnections?.syncError ?? ''}
        onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
        onRetrySync={cloudConnections?.retrySync ?? (async () => {})} />;
    }
    const programContent = CLOUD_PROGRAM_MANAGEMENT_ENABLED && programRepository
      ? <CloudProgramsPage repository={programRepository} clients={[selectedClient]}
        clientScope={selectedClient} hideToolbar
        onOpen={(plan) => {
          setClientProgramDetailNavigation(null);
          setClientSelectedProgram(plan);
        }}
        cloudStatus={cloudConnections?.status ?? 'loading'}
        cloudError={cloudConnections?.error ?? ''}
        syncStatus={cloudConnections?.syncStatus ?? 'pending'}
        syncError={cloudConnections?.syncError ?? ''}
        onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
        onRetrySync={cloudConnections?.retrySync ?? (async () => {})} />
      : <Text variant="body" tone="muted">Программы пока недоступны</Text>;
    return <ClientWorkspace client={selectedClient} tab={clientTab}
      onTabChange={setClientTab} programContent={clientTab === 'program' ? programContent : null}
      exercisesContent={clientTab === 'exercises' ? <ClientPerformedExercisesPage client={selectedClient} /> : null} />;
  }

  if (destination === 'today') {
    return (
      <TodayPage
        actor={actor}
        initData={initData}
        role="coach"
        onNavigationContextChange={onNavigationContextChange}
      />
    );
  }

  if (destination === 'exercises') {
    return <CoachExercises onNavigationContextChange={onNavigationContextChange} />;
  }

  if (destination === 'programs') {
    if (CLOUD_PROGRAM_MANAGEMENT_ENABLED && programRepository) {
      if (selectedCloudProgram) return (
        <CloudProgramDetailsPage onNavigationContextChange={setProgramDetailNavigation} actor={actor} viewerRole="coach" key={selectedCloudProgram.id} repository={programRepository} planId={selectedCloudProgram.id}
          cloudStatus={cloudConnections?.status ?? 'loading'}
          cloudError={cloudConnections?.error ?? ''}
          syncStatus={cloudConnections?.syncStatus ?? 'pending'}
          syncError={cloudConnections?.syncError ?? ''}
          onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
          onRetrySync={cloudConnections?.retrySync ?? (async () => {})} />
      );
      return (
        <CloudProgramsPage repository={programRepository} clients={clients ?? []}
          onNavigationContextChange={onNavigationContextChange}
          cloudStatus={cloudConnections?.status ?? 'loading'}
          cloudError={cloudConnections?.error ?? ''}
          syncStatus={cloudConnections?.syncStatus ?? 'pending'}
          syncError={cloudConnections?.syncError ?? ''}
          onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
          onRetrySync={cloudConnections?.retrySync ?? (async () => {})}
          onOpen={setSelectedCloudProgram} />
      );
    }

    if (selectedProgram) {
      return <ProgramDetailsPage initData={initData} programId={selectedProgram.id} />;
    }

    if (selectingProgramClient) {
      return (
        <section className="coach-directory">
          <ClientDirectory
            clients={clients}
            error={message}
            onRetry={() => { void loadClients(); }}
            onSelect={(client) => {
              requestBackTransition(() => {
                setProgramDraft((draft) => draft ? { ...draft, owner: { type: 'client', client } } : draft);
                setSelectingProgramClient(false);
              });
            }}
          />
        </section>
      );
    }

    const selectProgramClient = async (userId: string | number) => {
      const client = clients?.find((item) => item.userId === userId);
      if (!client) throw new Error('Клиент больше не связан с тренером');
      setSelectedClientId(client.userId);
      setClientTab('overview');
      setClientSelectedProgram(null);
      setClientProgramDetailNavigation(null);
    };

    const saveProgram = async () => {
      if (!programDraft?.name.trim() || programCreateBusy) return;
      if (!programDraft.owner) {
        setProgramCreateError('Выберите клиента или «Моя программа»');
        return;
      }
      setProgramCreateBusy(true);
      setProgramCreateError('');
      try {
        if (programDraft.owner.type === 'client') {
          if (!CLOUD_ASSIGNED_PROGRAMS_ENABLED) {
            throw new Error('Назначение программ будет доступно после активации Dexie Cloud');
          }
          if (!cloudPrograms) throw new Error('Dexie Cloud недоступен');
          await cloudPrograms.repository.createAssigned(
            programDraft.owner.client.telegramUserId,
            programDraft.name.trim(),
          );
        } else {
          await createCoachProgram(initData, programDraft.name.trim(), { type: 'self' });
        }
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
        clients={clients ?? []}
        onSelectClient={selectProgramClient}
        onOpenProgram={setSelectedProgram}
        creationDraft={programDraft}
        creationBusy={programCreateBusy}
        creationError={programCreateError}
        refreshKey={programRefreshKey}
        onOpenCreation={openProgramCreation}
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

  const copyInvite = async () => {
    if (!inviteUrl) return;
    setInviteCopyError('');
    try {
      await navigator.clipboard.writeText(inviteUrl);
      closeInvite();
    } catch {
      setInviteCopyError('Не удалось скопировать ссылку автоматически. Попробуйте ещё раз.');
    }
  };

  return (
    <section className="coach-directory">
      <header className="coach-directory-header">
        <div>
          <div className="eyebrow">Тренер</div>
          <Text variant="large-title" role="heading" aria-level={2}>Клиенты</Text>
        </div>
      </header>

      <ClientDirectory
        clients={clients}
        error={message}
        onRetry={() => { void loadClients(); }}
        onSelect={(client) => {
          setSelectedClientId(client.userId);
          setClientTab('overview');
          setClientSelectedProgram(null);
          setClientProgramDetailNavigation(null);
        }}
        onAdd={createInvite}
        busy={busy}
        presentation="contacts"
      />

      <MezfitDialog
        opened={Boolean(inviteUrl)}
        title="Пригласить клиента"
        content={<Text variant="body">Отправьте персональную ссылку клиенту в Telegram. Ссылка одноразовая и действует 30 дней.</Text>}
        buttons={<MezfitDialogButton strong onClick={() => void copyInvite()}>Копировать ссылку</MezfitDialogButton>}
        onBackdropClick={closeInvite}
        role="alertdialog"
        aria-modal="true"
        aria-hidden={!inviteUrl}
        aria-label="Пригласить клиента"
      >
        {inviteCopyError ? <Text variant="footnote" className="invite-copy-error error-text" role="alert">{inviteCopyError}</Text> : null}
      </MezfitDialog>

      {inviteError ? <p className="inline-message" role="alert">{inviteError}</p> : null}
    </section>
  );
}
