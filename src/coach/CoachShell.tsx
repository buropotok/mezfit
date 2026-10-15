import { useCallback, useEffect, useMemo, useState } from 'react';
import { List as KonstaList, ListGroup, ListItem as KonstaListItem } from 'konsta/react';
import {
  createClientInvite,
  createCoachProgram,
  type ProgramListItem,
} from '../api';
import { useNavigationBackTransition, useNavigationFloatingAction, type AppDestination, type NavigationContext } from '../NavigationShell';
import { Button, List, ListItem, MezfitDialog, MezfitDialogButton, Tabs, TabsContent, TabsList, TabsTrigger, Text } from '../ui';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_ASSIGNED_PROGRAMS_ENABLED } from '../data/cloud/pilot-activation';
import { CoachExercises } from '../exercises/CoachExercises';
import { ProgramDetailsPage } from './ProgramDetailsPage';
import { CloudProgramsPage } from '../program/CloudProgramsPage';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { CLOUD_PROGRAM_MANAGEMENT_ENABLED } from '../data/cloud/program-management-activation';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { TodayPage } from '../schedule/TodayPage';
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
  analytics: { title: 'Аналитика', text: 'Здесь появятся аналитика клиентов, тренировок и нагрузки.' },
  calendar: { title: 'Календарь', text: 'Здесь появится сводный календарь тренировок всех клиентов.' },
  settings: { title: 'Настройки', text: 'Системные настройки будут добавляться отдельными задачами.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function displayName(client: CloudContact): string {
  return client.displayName;
}

const clientNameCollator = new Intl.Collator(['ru-RU', 'en-US'], {
  sensitivity: 'base',
  numeric: true,
});

function clientSortName(client: CloudContact): string {
  return displayName(client).trim() || 'Клиент Mezfit';
}

function clientGroupTitle(client: CloudContact): string {
  const [firstCharacter = ''] = Array.from(clientSortName(client).normalize('NFC'));
  if (!firstCharacter || !/^\p{L}$/u.test(firstCharacter)) return '#';

  const [upperCharacter = firstCharacter] = Array.from(firstCharacter.toLocaleUpperCase('ru-RU'));
  return upperCharacter;
}

function groupClientsForContacts(clients: CloudContact[]): Array<{ title: string; clients: CloudContact[] }> {
  const groups = new Map<string, CloudContact[]>();

  for (const client of [...clients].sort((left, right) => clientNameCollator.compare(clientSortName(left), clientSortName(right)))) {
    const title = clientGroupTitle(client);
    const group = groups.get(title);
    if (group) group.push(client);
    else groups.set(title, [client]);
  }

  return Array.from(groups, ([title, groupedClients]) => ({ title, clients: groupedClients }))
    .sort((left, right) => {
      if (left.title === '#') return 1;
      if (right.title === '#') return -1;
      return clientNameCollator.compare(left.title, right.title);
    });
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

function ClientWorkspace({ client }: { client: CloudContact }) {
  const [tab, setTab] = useState<ClientTab>('overview');
  const name = displayName(client);

  return (
    <Tabs className="stack client-workspace" value={tab} onValueChange={(value) => setTab(value as ClientTab)}>
      <TabsList aria-label={`Разделы клиента ${name}`}>
        {tabs.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
      </TabsList>

      <TabsContent value="overview"><Placeholder title="Обзор" text="Здесь появятся последняя тренировка, следующая тренировка и быстрые действия тренера." /></TabsContent>
      <TabsContent value="program"><Placeholder title="Программа" text="Редактор назначенной программы будет следующим вертикальным срезом." /></TabsContent>
      <TabsContent value="exercises"><Placeholder title="Упражнения" text="Каталог упражнений клиента будет доступен после перевода этого раздела на Dexie Cloud." /></TabsContent>
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
  const contactGroups = presentation === 'contacts' && clients ? groupClientsForContacts(clients) : [];
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
          <KonstaList dividers={false}>
            {contactGroups.map((group) => (
              <ListGroup key={group.title}>
                <KonstaListItem
                  title={group.title}
                  groupTitle
                  className="sticky top-0"
                />
                {group.clients.map((client) => {
                  const name = displayName(client);
                  return (
                    <KonstaListItem
                      key={client.relationshipId}
                      contacts
                      link
                      chevron={false}
                      media={<CloudContactAvatar contact={client} />}
                      title={name}
                      linkComponent="button"
                      linkProps={{
                        type: 'button',
                        'aria-label': `Открыть клиента ${name}`,
                        onClick: () => onSelect(client),
                      }}
                    />
                  );
                })}
              </ListGroup>
            ))}
          </KonstaList>
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
  initData: string;
  destination: AppDestination;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}

export function CoachShell({ initData, destination, onNavigationContextChange }: CoachShellProps) {
  const requestBackTransition = useNavigationBackTransition();
  const cloudPrograms = useAssignedPrograms();
  const cloudConnections = useCloudConnections();
  const programRepository = useMemo(() => cloudConnections
    ? new ProgramManagementRepository(cloudConnections.db, cloudConnections.actorUserId)
    : null, [cloudConnections?.db, cloudConnections?.actorUserId]);
  const clients = cloudConnections?.status === 'loading' ? null : cloudConnections?.clients ?? null;
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const selectedClient = clients?.find((client) => client.userId === selectedClientId) ?? null;
  const [selectedProgram, setSelectedProgram] = useState<ProgramListItem | null>(null);
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
      onNavigationContextChange({ title: 'Детали программы', scrollKey: `cloud-plan:${selectedCloudProgram.id}`, onBack: () => setSelectedCloudProgram(null) });
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

    const selectedClientName = displayName(selectedClient);
    onNavigationContextChange({
      title: selectedClientName,
      scrollKey: `client:${selectedClient.userId}`,
      identity: {
        title: selectedClientName,
        avatar: {
          name: selectedClientName,
                  },
      },
      onBack: () => setSelectedClientId(null),
    });
    return () => onNavigationContextChange(null);
  }, [destination, selectedClient, selectedProgram, selectedCloudProgram, selectingProgramClient, onNavigationContextChange]);

  if (selectedClient) {
    return <ClientWorkspace client={selectedClient} />;
  }

  if (destination === 'today') {
    return (
      <TodayPage
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
        <CloudProgramDetailsPage repository={programRepository} planId={selectedCloudProgram.id}
          cloudStatus={cloudConnections?.status ?? 'loading'}
          cloudError={cloudConnections?.error ?? ''}
          onRetryCloud={cloudConnections?.refresh ?? (async () => {})} />
      );
      return (
        <CloudProgramsPage repository={programRepository} clients={clients ?? []}
          cloudStatus={cloudConnections?.status ?? 'loading'}
          cloudError={cloudConnections?.error ?? ''}
          onRetryCloud={cloudConnections?.refresh ?? (async () => {})}
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
    };

    const saveProgram = async () => {
      if (!programDraft?.name.trim() || !programDraft.owner || programCreateBusy) return;
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
        onSelect={(client) => setSelectedClientId(client.userId)}
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
