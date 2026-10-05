import { List as KonstaList, ListItem as KonstaListItem, Radio as KonstaRadio } from 'konsta/react';
import { Avatar, MezfitDialog } from '../ui';
import { useClientCoach } from './ClientCoachContext';

interface ClientCoachSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientCoachSelectorModal({ isOpen, onClose }: ClientCoachSelectorModalProps) {
  const { coaches, selectedCoach, status, error, selectCoach } = useClientCoach();

  return (
    <MezfitDialog
      opened={isOpen}
      onBackdropClick={onClose}
      title="Тренер"
      content={(
        <KonstaList nested className="-mx-4">
          {status === 'loading' || status === 'idle' ? (
            <KonstaListItem title="Загружаем тренеров…" />
          ) : null}
          {status === 'error' ? (
            <KonstaListItem title="Не удалось загрузить тренеров" subtitle={error} />
          ) : null}
          {status === 'ready' && coaches.length === 0 ? (
            <KonstaListItem title="Тренеров пока нет" subtitle="Примите приглашение тренера, чтобы он появился здесь." />
          ) : null}
          {status === 'ready' ? coaches.map((coach) => {
            const name = [coach.user.firstName, coach.user.lastName].filter(Boolean).join(' ');
            const selected = coach.user.id === selectedCoach?.user.id;
            return (
              <KonstaListItem
                key={coach.relationshipId}
                label
                media={<Avatar name={name} src={coach.user.photoUrl ?? undefined} />}
                title={name}
                subtitle={coach.user.username ? `@${coach.user.username}` : undefined}
                after={(
                  <KonstaRadio
                    component="div"
                    name="client-coach"
                    value={String(coach.user.id)}
                    checked={selected}
                    onChange={() => {
                      selectCoach(coach.user.id);
                      onClose();
                    }}
                  />
                )}
              />
            );
          }) : null}
        </KonstaList>
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Тренер"
    />
  );
}
