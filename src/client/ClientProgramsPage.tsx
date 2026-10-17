import { useEffect, useMemo, useState } from 'react';
import type { ProgramActor } from '../program/ProgramSummary';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { CloudProgramsPage } from '../program/CloudProgramsPage';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import type { ProgramControls, ProgramFilter } from '../program/ProgramToolbar';
import type { NavigationContext } from '../NavigationShell';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { useCloudConnections, type CloudContact, type CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_PROGRAM_MANAGEMENT_ENABLED } from '../data/cloud/program-management-activation';
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

function CloudClientProgramsWorkspace({
  repository, cloudStatus, cloudError, syncStatus, syncError, onRetry, onRetrySync,
  onNavigationContextChange, actor, coaches,
}: {
  actor?: ProgramActor;
  coaches: readonly CloudContact[];
  repository: ProgramManagementRepository;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetry: () => Promise<void>;
  onRetrySync: () => Promise<void>;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const [detailNavigation, setDetailNavigation] = useState<NavigationContext | null>(null);
  const [selected, setSelected] = useState<CloudTrainingPlanRow | null>(null);
  const [filter, setFilter] = useState<ProgramFilter>('all');
  const controls: ProgramControls = { filter, onFilterChange: setFilter, search: '', onSearchChange: () => {} };
  useEffect(() => {
    onNavigationContextChange?.(selected ? detailNavigation ?? {
      title: 'Детали программы', scrollKey: `client-program:${selected.id}`,
      onBack: () => setSelected(null),
    } : null);
    return () => onNavigationContextChange?.(null);
  }, [selected?.id, detailNavigation, onNavigationContextChange]);
  if (selected) return <CloudProgramDetailsPage onNavigationContextChange={setDetailNavigation} key={selected.id} repository={repository}
    planId={selected.id} viewerRole="client" readOnly={selected.coachUserId !== null} actor={actor}
    cloudStatus={cloudStatus} cloudError={cloudError} syncStatus={syncStatus} syncError={syncError}
    onRetryCloud={onRetry} onRetrySync={onRetrySync} />;
  return <CloudProgramsPage repository={repository} viewerRole="client" clients={[]} coaches={coaches}
    controls={controls} onOpen={setSelected} onNavigationContextChange={onNavigationContextChange}
    cloudStatus={cloudStatus} cloudError={cloudError} syncStatus={syncStatus} syncError={syncError}
    onRetryCloud={onRetry} onRetrySync={onRetrySync} />;
}

export function ClientProgramsPage({
  onNavigationContextChange, actor,
}: {
  actor?: ProgramActor;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
} = {}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new ProgramManagementRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  if (CLOUD_PROGRAM_MANAGEMENT_ENABLED && repository && cloud) {
    return <CloudClientProgramsWorkspace key={cloud.actorUserId} repository={repository} actor={actor} coaches={cloud.coaches}
      cloudStatus={cloud.status} cloudError={cloud.error}
      syncStatus={cloud.syncStatus} syncError={cloud.syncError}
      onRetry={cloud.refresh} onRetrySync={cloud.retrySync}
      onNavigationContextChange={onNavigationContextChange} />;
  }
  // Compatibility for installations not yet provisioned with Dexie Cloud.
  if (!CLOUD_ASSIGNED_PROGRAMS_ENABLED) {
    return <List><ListItem interactive={false} title="Программы пока недоступны" subtitle="Для назначения программ необходимо настроить доступ к Mezfit облаку." /></List>;
  }
  return <CloudClientProgramsPage />;
}

