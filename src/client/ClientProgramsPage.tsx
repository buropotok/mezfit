import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { Button, List, ListItem, Text } from '../ui';
import { useClientCoach } from './ClientCoachContext';

export function ClientProgramsPage() {
  const { selectedCoach, status: coachStatus, error: coachError } = useClientCoach();
  const cloud = useAssignedPrograms();

  if (coachStatus === 'loading' || coachStatus === 'idle') {
    return <List><ListItem interactive={false} title="Загружаем тренеров…" /></List>;
  }

  if (coachStatus === 'error') {
    return <List><ListItem interactive={false} title="Не удалось загрузить тренеров" subtitle={coachError} /></List>;
  }

  if (!selectedCoach) {
    return <List><ListItem interactive={false} title="Нет выбранного тренера" subtitle="Подключитесь к тренеру, чтобы увидеть назначенные программы." /></List>;
  }

  if (!cloud || cloud.status === 'loading') {
    return <List><ListItem interactive={false} title="Загружаем программы…" /></List>;
  }

  if (cloud.status === 'error') {
    return (
      <List>
        <ListItem interactive={false} title="Не удалось загрузить программы" subtitle={cloud.error} />
        <Button onClick={() => { void cloud.refresh().catch(() => undefined); }}>Повторить</Button>
      </List>
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
          subtitle={<Text variant="footnote" tone="muted">{program.status === 'draft' ? 'Черновик' : program.status === 'active' ? 'Активная' : 'Завершена'}</Text>}
        />
      ))}
    </List>
  );
}
