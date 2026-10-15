import { useEffect, useMemo, useState } from 'react';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { CloudProgramsPage } from '../program/CloudProgramsPage';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import type { NavigationContext } from '../NavigationShell';
import { ProgramManagementRepository, type ProgramDetails } from '../data/cloud/program-management';
import { useCloudConnections, type CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_PROGRAM_MANAGEMENT_ENABLED } from '../data/cloud/program-management-activation';
import { Badge, Button as CloudButton, GlassSurface, Tabs, TabsList, TabsTrigger, Text } from '../ui';
import './client-programs-cloud.css';
import { CLOUD_ASSIGNED_PROGRAMS_ENABLED } from '../data/cloud/pilot-activation';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { Button, List, ListItem } from '../ui';
import { useClientCoach } from './ClientCoachContext';

function CloudClientProgramsPage() {
  const { selectedCoach, status: coachStatus, error: coachError, refreshCoaches } = useClientCoach();
  const cloud = useAssignedPrograms();

  if (coachStatus === 'loading' || coachStatus === 'idle') {
    return <List><ListItem interactive={false} title="Загружаем тренеров…" /></List>;
  }

  if (coachStatus === 'error') {
    return <section><List><ListItem interactive={false} title="Не удалось загрузить тренеров" subtitle={coachError} /></List><Button onClick={refreshCoaches}>Повторить</Button></section>;
  }

  if (!selectedCoach) {
    return <List><ListItem interactive={false} title="Нет выбранного тренера" subtitle="Подключитесь к тренеру, чтобы увидеть назначенные программы." /></List>;
  }

  if (!cloud || cloud.status === 'loading') {
    return <List><ListItem interactive={false} title="Загружаем программы…" /></List>;
  }

  if (cloud.status === 'error') {
    return (
      <section>
        <List><ListItem interactive={false} title="Не удалось загрузить программы" subtitle={cloud.error} /></List>
        <Button onClick={() => { void cloud.refresh().catch(() => undefined); }}>Повторить</Button>
      </section>
    );
  }

  const programs = cloud.plans.filter((plan) =>
    plan.coachUserId === selectedCoach.userId
    && plan.clientUserId === cloud.actorUserId);

  if (programs.length === 0) {
    return <List><ListItem interactive={false} title="Программ пока нет" subtitle="У выбранного тренера пока нет назначенной вам программы." /></List>;
  }

  return (
    <List>
      {programs.map((program) => (
        <ListItem
          key={program.id}
          interactive={false}
          title={program.name}
          subtitle={program.status === 'draft' ? 'Черновик'
            : program.status === 'active' ? 'Активная'
              : program.status === 'cancelled' ? 'Отменена' : 'Завершена'}
        />
      ))}
    </List>
  );
}

function AthleteProgramPage({
  repository, actorUserId, coachUserId, cloudStatus, cloudError,
  syncStatus, syncError, onRetry, onRetrySync,
}: {
  repository: ProgramManagementRepository;
  actorUserId: string;
  coachUserId: string;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetry: () => Promise<void>;
  onRetrySync: () => Promise<void>;
}) {
  const [data, setData] = useState<ProgramDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    const subscription = repository.observeActiveForAthlete(actorUserId, coachUserId, (current) => {
      if (!active) return;
      setData(current);
      setLoaded(true);
      setError('');
    }, (reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить программу');
      setLoaded(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, actorUserId, coachUserId, retryKey]);
  const syncWarning = syncStatus === 'error'
    ? syncError || 'Не удалось синхронизировать программу'
    : syncStatus === 'offline'
      ? syncError || 'Облако недоступно. Показана локальная копия.'
      : syncStatus === 'pending'
        ? 'Синхронизация программы ещё не подтверждена.' : '';
  const retry = () => {
    void (async () => {
      if (cloudStatus === 'error') await onRetry();
      if (syncStatus === 'error' || syncStatus === 'offline') await onRetrySync();
    })().catch(() => {}).finally(() => setRetryKey((key) => key + 1));
  };
  if (error || (cloudStatus === 'error' && !data)) return (
    <section className="cloud-client-program">
      <Text variant="footnote" role="alert">{error || cloudError || 'Не удалось синхронизировать программу'}</Text>
      <CloudButton onClick={retry}>Повторить</CloudButton>
    </section>
  );
  if (!loaded || cloudStatus === 'loading') return <Text variant="footnote" tone="muted">Загружаем программу…</Text>;
  if (!data) return syncWarning ? (
    <section className="cloud-plan-error">
      <Text variant="footnote" role={syncStatus === 'pending' ? 'status' : 'alert'}>
        {syncWarning}
      </Text>
      <Text variant="footnote" tone="muted">
        Пока нет подтверждения от облака, нельзя утверждать, что активная программа отсутствует.
      </Text>
      {syncStatus !== 'pending' ? (
        <CloudButton variant="secondary" onClick={retry}>Повторить</CloudButton>
      ) : null}
    </section>
  ) : (
    <List><ListItem interactive={false} title="Нет активной программы"
      subtitle="Активная программа появится здесь после назначения или активации." /></List>
  );
  const visiblePhases = data.phases;
  return (
    <section className="cloud-client-program" aria-label="Активная программа">
      {cloudStatus === 'error' || syncWarning ? (
        <div className="cloud-plan-error">
          {cloudStatus === 'error' ? (
            <Text variant="footnote" role="alert">
              {cloudError || 'Не удалось синхронизировать список тренеров'}
            </Text>
          ) : null}
          {syncWarning ? (
            <Text variant="footnote" role={syncStatus === 'pending' ? 'status' : 'alert'}>
              {syncWarning}
            </Text>
          ) : null}
          {syncStatus !== 'synced' ? (
            <Text variant="footnote" tone="muted">
              Изменения могут оставаться только на этом устройстве до завершения синхронизации.
            </Text>
          ) : null}
          {(cloudStatus === 'error' || syncStatus === 'error' || syncStatus === 'offline') ? (
            <CloudButton variant="secondary" onClick={retry}>Повторить синхронизацию</CloudButton>
          ) : null}
        </div>
      ) : null}
      <GlassSurface preset="modalTuned" optics={false} className="cloud-client-program-summary">
        <div className="cloud-client-program-summary-content">
          <Text variant="large-title">{data.program.name}</Text>
          <Badge color="green">Активная</Badge>
        </div>
      </GlassSurface>
      <Text variant="title">Фазы программы</Text>
      {visiblePhases.map((phase) => (
        <div key={phase.id} className="cloud-client-program-phase">
          <div className="cloud-client-program-phase-title"><Text variant="headline">{phase.name}</Text></div>
          <Text variant="footnote" tone="muted">{phase.durationWeeks ?? 10} недель</Text>
          <Badge color={phase.status === 'active' ? 'green' :
            phase.status === 'finished' ? 'blue' :
              phase.status === 'cancelled' ? 'red' : 'yellow'}>
            {phase.status === 'active' ? 'Активная' :
              phase.status === 'finished' ? 'Завершена' :
                phase.status === 'cancelled' ? 'Отменена' : 'В ожидании'}
          </Badge>
        </div>
      ))}
      {visiblePhases.length === 0 ? <Text variant="footnote" tone="muted">
        В активной программе ещё нет подготовленных фаз.
      </Text> : null}
    </section>
  );
}

function CloudClientProgramsWorkspace({
  repository, cloudStatus, cloudError, syncStatus, syncError, onRetry, onRetrySync,
  onNavigationContextChange,
}: {
  repository: ProgramManagementRepository;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetry: () => Promise<void>;
  onRetrySync: () => Promise<void>;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const { selectedCoach, status: coachStatus, error: coachError } = useClientCoach();
  const [source, setSource] = useState<'coach' | 'personal'>('coach');
  const [selectedPersonal, setSelectedPersonal] = useState<CloudTrainingPlanRow | null>(null);

  useEffect(() => {
    onNavigationContextChange?.(selectedPersonal ? {
      title: 'Детали программы',
      scrollKey: `personal-program:${selectedPersonal.id}`,
      onBack: () => setSelectedPersonal(null),
    } : null);
    return () => onNavigationContextChange?.(null);
  }, [selectedPersonal?.id, onNavigationContextChange]);

  if (selectedPersonal) {
    return <CloudProgramDetailsPage repository={repository} planId={selectedPersonal.id}
      cloudStatus={cloudStatus} cloudError={cloudError}
      syncStatus={syncStatus} syncError={syncError} onRetryCloud={onRetrySync} />;
  }
  return (
    <section className="cloud-client-programs-workspace">
      <Tabs value={source} onValueChange={(value) => setSource(value as 'coach' | 'personal')}>
        <TabsList aria-label="Источник программы">
          <TabsTrigger value="coach">От тренера</TabsTrigger>
          <TabsTrigger value="personal">Мои программы</TabsTrigger>
        </TabsList>
      </Tabs>
      {source === 'personal' ? (
        <CloudProgramsPage repository={repository} personalOnly clients={[]}
          cloudStatus={cloudStatus} cloudError={cloudError}
          syncStatus={syncStatus} syncError={syncError}
          onRetryCloud={onRetry} onRetrySync={onRetrySync}
          onOpen={setSelectedPersonal} />
      ) : selectedCoach ? (
        <AthleteProgramPage repository={repository}
          actorUserId={repository.actorUserId} coachUserId={selectedCoach.userId}
          cloudStatus={cloudStatus} cloudError={cloudError}
          syncStatus={syncStatus} syncError={syncError}
          onRetry={onRetry} onRetrySync={onRetrySync} />
      ) : coachStatus === 'error' || cloudStatus === 'error' ? (
        <section className="cloud-plan-error">
          <Text variant="footnote" role="alert">
            {coachError || cloudError || 'Не удалось загрузить список тренеров'}
          </Text>
          <CloudButton variant="secondary" onClick={() => {
            void onRetry().catch(() => {});
          }}>Повторить</CloudButton>
        </section>
      ) : coachStatus === 'loading' || coachStatus === 'idle' || cloudStatus === 'loading' ? (
        <Text variant="footnote" tone="muted">Загружаем тренеров…</Text>
      ) : (
        <List><ListItem interactive={false} title="Нет выбранного тренера"
          subtitle="Выберите тренера для просмотра назначенной программы или перейдите в «Мои программы»." /></List>
      )}
    </section>
  );
}

export function ClientProgramsPage({
  onNavigationContextChange,
}: {
  onNavigationContextChange?: (context: NavigationContext | null) => void;
} = {}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new ProgramManagementRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  if (CLOUD_PROGRAM_MANAGEMENT_ENABLED && repository && cloud) {
    return <CloudClientProgramsWorkspace repository={repository}
      cloudStatus={cloud.status} cloudError={cloud.error}
      syncStatus={cloud.syncStatus} syncError={cloud.syncError}
      onRetry={cloud.refresh} onRetrySync={cloud.retrySync}
      onNavigationContextChange={onNavigationContextChange} />;
  }
  // Compatibility for installations not yet provisioned with Dexie Cloud.
  if (!CLOUD_ASSIGNED_PROGRAMS_ENABLED) {
    return <List><ListItem interactive={false} title="Программы пока недоступны" subtitle="Для назначения программ необходимо активировать проверенные права Dexie Cloud." /></List>;
  }
  return <CloudClientProgramsPage />;
}

