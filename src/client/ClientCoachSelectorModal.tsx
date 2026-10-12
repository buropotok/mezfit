import { List as KonstaList, ListItem as KonstaListItem, Radio as KonstaRadio } from 'konsta/react';
import { MezfitDialog } from '../ui';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { useClientCoach } from './ClientCoachContext';

interface ClientCoachSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ClientCoachSelectorModal({ isOpen, onClose }: ClientCoachSelectorModalProps) {
  const { coaches, selectedCoach, status, error, selectCoach, refreshCoaches } = useClientCoach();

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
            <>
              <KonstaListItem title="Не удалось загрузить тренеров" subtitle={error} />
              <KonstaListItem title="Повторить" link onClick={refreshCoaches} />
            </>
          ) : null}
          {status === 'ready' && coaches.length === 0 ? (
            <KonstaListItem title="Тренеров пока нет" subtitle="Примите приглашение тренера, чтобы он появился здесь." />
          ) : null}
          {status === 'ready' ? coaches.map((coach) => {
            const name = coach.displayName;
            const selected = coach.userId === selectedCoach?.userId;
            return (
              <KonstaListItem
                key={coach.relationshipId}
                label
                media={<CloudContactAvatar contact={coach} />}
                title={name}
                after={(
                  <KonstaRadio
                    component="div"
                    name="client-coach"
                    value={coach.userId}
                    checked={selected}
                    onChange={() => {
                      selectCoach(coach.userId);
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
