import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { athleteOf, clientVisiblePhases, ProgramManagementRepository, type ProgramDetails } from '../data/cloud/program-management';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { CLOUD_PROGRAM_MANAGEMENT_ENABLED } from '../data/cloud/program-management-activation';
import { Badge, GlassSurface, Text } from '../ui';
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
          subtitle={program.status === 'draft' ? 'Черновик' : program.status === 'active' ? 'Активная' : 'Завершена'}
        />
      ))}
    </List>
  );
}

function AthleteProgramPage({
  repository, actorUserId, cloudReady,
}: { repository: ProgramManagementRepository; actorUserId: string; cloudReady: boolean }) {
  const [data, setData] = useState<ProgramDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoaded(false);
    const subscription = liveQuery(async () => {
      const activePlan = (await repository.listReadable()).find((plan) =>
        athleteOf(plan) === actorUserId && plan.status === 'active');
      return activePlan ? repository.details(activePlan.id) : null;
    }).subscribe({
      next: (current) => {
        if (!active) return;
        setData(current);
        setLoaded(true);
        setError('');
      },
      error: (reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить программу');
        setLoaded(true);
      },
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, actorUserId]);
  if (error) return <Text variant="footnote" role="alert">{error}</Text>;
  if (!loaded || !cloudReady) return <Text variant="footnote" tone="muted">Загружаем программу…</Text>;
  if (!data) return (
    <List><ListItem interactive={false} title="Нет активной программы"
      subtitle="Активная программа появится здесь после назначения или активации." /></List>
  );
  const visiblePhases = clientVisiblePhases(data.phases);
  return (
    <section className="cloud-client-program" aria-label="Активная программа">
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

export function ClientProgramsPage() {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new ProgramManagementRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  if (CLOUD_PROGRAM_MANAGEMENT_ENABLED && repository && cloud) {
    return <AthleteProgramPage repository={repository} actorUserId={cloud.actorUserId}
      cloudReady={cloud.status === 'ready'} />;
  }
  // Compatibility for installations not yet provisioned with Dexie Cloud.
  if (!CLOUD_ASSIGNED_PROGRAMS_ENABLED) {
    return <List><ListItem interactive={false} title="Программы пока недоступны" subtitle="Для назначения программ необходимо активировать проверенные права Dexie Cloud." /></List>;
  }
  return <CloudClientProgramsPage />;
}

