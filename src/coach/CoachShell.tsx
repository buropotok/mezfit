import { DiscussionsPage } from '../discussions/DiscussionsPage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createClientInvite,
  createCoachProgram,
  resetTestClientRelationship,
  type ProgramListItem,
} from '../api';
import { useNavigationBackTransition, useNavigationFloatingAction, type AppDestination, type NavigationContext } from '../NavigationShell';
import { Button, List, ListItem, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { CoachInviteDialog } from './CoachInviteDialog';
import { PublishedUserProfile } from '../profile/PublishedUserProfile';
import { ProfileDataProvider } from '../profile/ProfileDataProvider';
import { ProfileWorkoutTimeline } from '../profile/ProfileWorkoutTimeline';
import { ProfileWorkspace, type ProfileTab } from '../profile/ProfileWorkspace';
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

const coachPlaceholderCopy: Partial<Record<AppDestination, { title: string; text: string }>> = {
  analytics: { title: 'Аналитика', text: 'Здесь появятся аналитика клиентов, тренировок и нагрузки.' },
  calendar: { title: 'Календарь', text: 'Здесь появится сводный календарь тренировок всех клиентов.' },
  settings: { title: 'Настройки', text: 'Системные настройки будут добавляться отдельными задачами.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function displayName(client: CloudContact): string {
  return client.displayName;
}

function GlobalPlaceholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="global-placeholder">
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
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
  requestedAvatarClient?: { userId: string; requestId: number } | null;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function CoachShell({ initData, actor, destination, requestedAvatarClient, onNavigationContextChange }: CoachShellProps) {
  const requestBackTransition = useNavigationBackTransition();
  const cloudPrograms = useAssignedPrograms();
  const cloudConnections = useCloudConnections();
  const programRepository = useMemo(() => cloudConnections
    ? new ProgramManagementRepository(cloudConnections.db, cloudConnections.actorUserId)
    : null, [cloudConnections?.db, cloudConnections?.actorUserId]);
  const clients = cloudConnections?.status === 'loading' ? null : cloudConnections?.clients ?? null;
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const appliedAvatarRequest = useRef<typeof requestedAvatarClient>(null);
  const selectedClient = clients?.find((client) => client.userId === selectedClientId) ?? null;
  const [clientTab, setClientTab] = useState<ProfileTab>('basics');
  const [resetTarget, setResetTarget] = useState<CloudContact | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const resetInFlight = useRef(false);
  const selectedClientIdRef = useRef(selectedClientId);
  selectedClientIdRef.current = selectedClientId;
  const [clientSelectedProgram, setClientSelectedProgram] = useState<CloudTrainingPlanRow | null>(null);
  const [clientProgramDetailNavigation, setClientProgramDetailNavigation] = useState<NavigationContext | null>(null);
  const [clientDiscussionNavigation, setClientDiscussionNavigation] = useState<NavigationContext | null>(null);
  const [clientWorkoutNavigation, setClientWorkoutNavigation] = useState<NavigationContext | null>(null);
  const [clientHistoryCalendar, setClientHistoryCalendar] = useState<NavigationContext['calendar']>();
  const [clientHistoryCalendarRequested, setClientHistoryCalendarRequested] = useState(false);
  const [clientExerciseNavigation, setClientExerciseNavigation] = useState<NavigationContext | null>(null);
  const selectedClientProgram = clientSelectedProgram && selectedClient
    && clientSelectedProgram.clientUserId === selectedClient.userId
    && clientSelectedProgram.realmId === selectedClient.relationshipId ? clientSelectedProgram : null;
  const selectedClientAvatarUrl = useCloudContactAvatarUrl(selectedClient);
  const [selectedProgram, setSelectedProgram] = useState<ProgramListItem | null>(null);
  const [programDetailNavigation, setProgramDetailNavigation] = useState<NavigationContext | null>(null);
  const [selectedCloudProgram, setSelectedCloudProgram] = useState<CloudTrainingPlanRow | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const message = cloudConnections?.status === 'error' ? cloudConnections.error : '';
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [programDraft, setProgramDraft] = useState<ProgramCreationDraft | null>(null);
  const [selectingProgramClient, setSelectingProgramClient] = useState(false);
  const [programCreateBusy, setProgramCreateBusy] = useState(false);
  const [programCreateError, setProgramCreateError] = useState('');
  const [programRefreshKey, setProgramRefreshKey] = useState(0);

  useEffect(() => {
    if (destination !== 'clients' || !requestedAvatarClient || appliedAvatarRequest.current === requestedAvatarClient) return;
    if (!clients?.some(client => client.userId === requestedAvatarClient.userId)) return;
    appliedAvatarRequest.current = requestedAvatarClient;
    setSelectedClientId(requestedAvatarClient.userId);
    setClientTab('basics');
    setClientSelectedProgram(null);
    setClientProgramDetailNavigation(null);
    setClientExerciseNavigation(null);
    setClientWorkoutNavigation(null);
  }, [destination, requestedAvatarClient, clients]);

  const loadClients = useCallback(() => {
    void cloudConnections?.refresh().then(() => setResetError('')).catch(() => undefined);
  }, [cloudConnections]);

  const createInvite = useCallback(async () => {
    setBusy(true);
    setInviteError('');
    try {
      const result = await createClientInvite(initData);
      setInviteUrl(result.telegramUrl);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Не удалось создать приглашение');
    } finally {
      setBusy(false);
    }
  }, [initData]);

  const confirmTestReset = useCallback(async () => {
    const target = resetTarget;
    if (!target || resetInFlight.current) return;
    resetInFlight.current = true;
    setResetBusy(true);
    setResetError('');
    try {
      await resetTestClientRelationship(initData, target.telegramUserId);
      // The server has confirmed removal; never retry the destructive call
      // only because a subsequent local pull failed.
      setResetTarget(null);
      if (selectedClientIdRef.current === target.userId) {
        setSelectedClientId(null);
        setClientSelectedProgram(null);
        setClientProgramDetailNavigation(null);
        setClientExerciseNavigation(null);
      }
      try {
        await cloudConnections?.refresh();
      } catch {
        setResetError('Связь удалена, но список не обновился. Повторите синхронизацию.');
      }
    } catch (reason) {
      setResetError(reason instanceof Error ? reason.message : 'Не удалось сбросить связь. Повторите попытку.');
    } finally {
      resetInFlight.current = false;
      setResetBusy(false);
    }
  }, [resetTarget, initData, cloudConnections]);

  const openProgramCreation = useCallback(() => {
    setProgramCreateError('');
    setProgramDraft({ name: '', owner: null });
  }, []);

  useEffect(() => {
    if (destination !== 'clients' && !resetBusy) setResetTarget(null);
  }, [destination, resetBusy]);

  useEffect(() => {
    if (clientTab !== 'history' || destination !== 'clients') setClientHistoryCalendarRequested(false);
  }, [clientTab, destination]);

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

    if (destination === 'discussions') return;

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

    if (clientTab === 'discussions' && clientDiscussionNavigation && destination === 'clients') {
      onNavigationContextChange(clientDiscussionNavigation);
      return () => onNavigationContextChange(null);
    }

    if ((clientTab === 'calendar' || clientTab === 'history') && clientWorkoutNavigation && destination === 'clients') {
      onNavigationContextChange(clientTab === 'history' && clientHistoryCalendar
        ? { ...clientWorkoutNavigation, calendar: clientHistoryCalendar }
        : clientWorkoutNavigation);
      return () => onNavigationContextChange(null);
    }

    if (clientTab === 'exercises' && clientExerciseNavigation && destination === 'clients') {
      onNavigationContextChange(clientExerciseNavigation);
      return () => onNavigationContextChange(null);
    }

    const selectedClientName = displayName(selectedClient);
    onNavigationContextChange({
      title: selectedClientName,
      scrollKey: `client:${cloudConnections?.actorUserId}:${selectedClient.relationshipId}:${selectedClient.userId}:${clientTab}`,
      restoreScroll: true,
      identity: {
        title: selectedClientName,
        avatar: {
          name: selectedClientName,
          src: selectedClientAvatarUrl,
        },
      },
      onIdentityClick: () => {
        setClientTab('basics');
        setClientSelectedProgram(null);
        setClientProgramDetailNavigation(null);
        setClientExerciseNavigation(null);
        setClientWorkoutNavigation(null);
      },
      onCalendarOpen: destination === 'clients' ? () => {
        setClientHistoryCalendarRequested(true);
        setClientTab('history');
      } : undefined,
      calendar: clientTab === 'history' ? clientHistoryCalendar : undefined,
      onBack: () => setSelectedClientId(null),
    });
    return () => onNavigationContextChange(null);
  }, [clientDiscussionNavigation, clientWorkoutNavigation, clientHistoryCalendar, programDetailNavigation, clientProgramDetailNavigation, clientExerciseNavigation, clientTab, cloudConnections?.actorUserId, destination, selectedClient, selectedClientProgram, selectedClientAvatarUrl, selectedProgram, selectedCloudProgram, selectingProgramClient, onNavigationContextChange]);

  if (destination === 'discussions') return <DiscussionsPage role="coach" onNavigationContextChange={onNavigationContextChange} />;

  if (selectedClient) {
    if (selectedClientProgram && destination === 'clients' && programRepository) {
      return <ProfileDataProvider tab={clientTab} contact={selectedClient}>
        <CloudProgramDetailsPage key={selectedClientProgram.id}
          onNavigationContextChange={setClientProgramDetailNavigation}
          actor={actor} viewerRole="coach" repository={programRepository} planId={selectedClientProgram.id}
          cloudStatus={cloudConnections?.status ?? 'loading'}
          cloudError={cloudConnections?.error ?? ''}
          syncStatus={cloudConnections?.syncStatus ?? 'pending'}
          syncError={cloudConnections?.syncError ?? ''}
          onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
          onRetrySync={cloudConnections?.retrySync ?? (async () => {})} />
      </ProfileDataProvider>;
    }
    const programContent = CLOUD_PROGRAM_MANAGEMENT_ENABLED && programRepository
      ? <CloudProgramsPage repository={programRepository} clients={[selectedClient]}
        clientScope={selectedClient}
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
    return <ProfileDataProvider tab={clientTab} contact={selectedClient}>
      <ProfileWorkspace view={{ kind: 'contact', contact: selectedClient }} tab={clientTab}
        basicsContent={<PublishedUserProfile key={selectedClient.relationshipId + ':' + selectedClient.userId} contact={selectedClient} />}
        hideTabs={clientTab === 'exercises' && clientExerciseNavigation !== null}
        discussionsContent={clientTab === 'discussions' ? <DiscussionsPage key={selectedClient.relationshipId} role="coach"
          relationshipId={selectedClient.relationshipId} onNavigationContextChange={setClientDiscussionNavigation} /> : null}
        onTabChange={tab => { setClientTab(tab); setClientWorkoutNavigation(null); }}
        programContent={clientTab === 'program' ? programContent : null}
        calendarContent={clientTab === 'calendar' ? <ProfileWorkoutTimeline key={selectedClient.relationshipId + ':plan'}
          mode="plan" role="coach" contact={selectedClient} actor={actor} initData={initData}
          onNavigationContextChange={setClientWorkoutNavigation} /> : null}
        historyContent={clientTab === 'history' ? <ProfileWorkoutTimeline key={selectedClient.relationshipId + ':history'}
          mode="history" role="coach" contact={selectedClient} actor={actor} initData={initData}
          onCalendarChange={clientHistoryCalendarRequested && destination === 'clients' ? setClientHistoryCalendar : undefined}
          onNavigationContextChange={setClientWorkoutNavigation} /> : null}
        exercisesContent={clientTab === 'exercises' ? <ClientPerformedExercisesPage
          key={`${cloudConnections?.actorUserId}:${selectedClient.relationshipId}`} client={selectedClient}
          onDetailNavigationChange={setClientExerciseNavigation} /> : null} />
      {destination === 'clients' && clientTab === 'basics' ? <div className="stack">
        <Button variant="secondary" disabled={resetBusy} onClick={() => {
          setResetError('');
          setResetTarget(selectedClient);
        }}>Сбросить тестовую связь</Button>
      </div> : null}
      <MezfitDialog opened={resetTarget?.relationshipId === selectedClient.relationshipId}
        title="Сбросить связь с клиентом?"
        content={<>
          <Text variant="body">Все данные общей связи с «{selectedClient.displayName}», включая программы и тренировки, будут безвозвратно удалены. Клиент сможет заново принять приглашение.</Text>
          {resetError ? <Text variant="footnote" role="alert">{resetError}</Text> : null}
        </>}
        buttons={<>
          <MezfitDialogButton disabled={resetBusy} onClick={() => setResetTarget(null)}>Отмена</MezfitDialogButton>
          <MezfitDialogButton strong tone="danger" disabled={resetBusy}
            onClick={() => { void confirmTestReset(); }}>{resetBusy ? 'Сбрасываем…' : 'Сбросить'}</MezfitDialogButton>
        </>}
        onBackdropClick={() => { if (!resetBusy) setResetTarget(null); }}
        role="alertdialog" aria-modal="true" aria-label="Сброс тестовой связи" />
    </ProfileDataProvider>;
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
      setClientTab('basics');
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
          setClientTab('basics');
          setClientSelectedProgram(null);
          setClientProgramDetailNavigation(null);
        }}
        onAdd={createInvite}
        busy={busy}
        presentation="contacts"
      />

      <CoachInviteDialog url={inviteUrl} onClose={() => setInviteUrl(null)} />

      {inviteError ? <p className="inline-message" role="alert">{inviteError}</p> : null}
      {resetError ? <div className="stack">
        <Text variant="footnote" role="alert">{resetError}</Text>
        <Button variant="secondary" onClick={loadClients}>Обновить связи</Button>
      </div> : null}
    </section>
  );
}
