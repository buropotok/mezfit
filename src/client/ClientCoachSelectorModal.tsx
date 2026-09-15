import { Avatar, List, ListItem, Modal } from '../ui';
import { useClientCoach } from './ClientCoachContext';

interface ClientCoachSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientCoachSelectorModal({ isOpen, onClose }: ClientCoachSelectorModalProps) {
  const { coaches, selectedCoach, status, error, selectCoach } = useClientCoach();

  return (
    <Modal isOpen={isOpen} title="Тренер" onClose={onClose}>
      <List>
        {status === 'loading' || status === 'idle' ? (
          <ListItem interactive={false} title="Загружаем тренеров…" />
        ) : null}
        {status === 'error' ? (
          <ListItem interactive={false} title="Не удалось загрузить тренеров" subtitle={error} />
        ) : null}
        {status === 'ready' && coaches.length === 0 ? (
          <ListItem interactive={false} title="Тренеров пока нет" subtitle="Примите приглашение тренера, чтобы он появился здесь." />
        ) : null}
        {status === 'ready' ? coaches.map((coach) => {
          const name = [coach.user.firstName, coach.user.lastName].filter(Boolean).join(' ');
          const selected = coach.user.id === selectedCoach?.user.id;
          return (
            <ListItem
              key={coach.relationshipId}
              leading={<Avatar name={name} src={coach.user.photoUrl ?? undefined} />}
              title={name}
              subtitle={coach.user.username ? `@${coach.user.username}` : undefined}
              trailing={selected ? 'Выбран' : undefined}
              onClick={() => {
                selectCoach(coach.user.id);
                onClose();
              }}
            />
          );
        }) : null}
      </List>
    </Modal>
  );
}
