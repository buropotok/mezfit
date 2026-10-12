import { useEffect, useState } from 'react';
import { getClientPrograms, type ProgramListItem } from '../api';
import { CLOUD_ASSIGNED_PROGRAMS_ENABLED } from '../data/cloud/pilot-activation';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { Button, List, ListItem } from '../ui';
import { useClientCoach } from './ClientCoachContext';

function programStatusLabel(program: ProgramListItem): string {
  if (program.status === 'active') return 'Активная';
  if (program.status === 'finished') return 'Завершена';
  return 'Черновик';
}

function LegacyClientProgramsPage({ initData }: { initData: string }) {
  const { selectedCoach, status: coachStatus, error: coachError } = useClientCoach();
  const [programs, setPrograms] = useState<ProgramListItem[] | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!selectedCoach) {
      setPrograms([]);
      setMessage('');
      return undefined;
    }

    let cancelled = false;
    setPrograms(null);
    setMessage('');

    getClientPrograms(initData, selectedCoach.user.id)
      .then((result) => {
        if (!cancelled) setPrograms(result.programs);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPrograms([]);
        setMessage(error instanceof Error ? error.message : 'Не удалось загрузить программы');
      });

    return () => { cancelled = true; };
  }, [initData, selectedCoach]);

  if (coachStatus === 'loading' || coachStatus === 'idle') {
    return <List><ListItem interactive={false} title="Загружаем тренеров…" /></List>;
  }

  if (coachStatus === 'error') {
    return <List><ListItem interactive={false} title="Не удалось загрузить тренеров" subtitle={coachError} /></List>;
  }

  if (!selectedCoach) {
    return <List><ListItem interactive={false} title="Нет выбранного тренера" subtitle="Подключитесь к тренеру, чтобы увидеть назначенные программы." /></List>;
  }

  if (programs === null) {
    return <List><ListItem interactive={false} title="Загружаем программы…" /></List>;
  }

  if (message) {
    return <List><ListItem interactive={false} title="Не удалось загрузить программы" subtitle={message} /></List>;
  }

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
          subtitle={programStatusLabel(program)}
        />
      ))}
    </List>
  );
}

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
    plan.coachUserId === `tg:${selectedCoach.user.telegramUserId}`
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

export function ClientProgramsPage({ initData }: { initData: string }) {
  return CLOUD_ASSIGNED_PROGRAMS_ENABLED
    ? <CloudClientProgramsPage />
    : <LegacyClientProgramsPage initData={initData} />;
}
