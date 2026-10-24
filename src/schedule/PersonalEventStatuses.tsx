import { useEffect, useRef, useState } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { PersonalEventRepository } from '../data/cloud/personal-events';
import { workoutHasDelta } from '../data/cloud/workout-sync';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { Badge, LiquidPopover } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';

/**
 * Publication and replication are independent: an unsaved editor value is not
 * persisted; existing personal events are already published on local save.
 */
export function PersonalEventStatuses({ eventId, repository }: {
  eventId: string | null;
  repository: PersonalEventRepository | null;
}) {
  const cloud = useCloudConnections();
  const [row, setRow] = useState<LocalProgramSyncRow>();
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();

  useEffect(() => {
    setRow(undefined);
    setFailed(false);
    setOpened(false);
    if (!cloud || !repository || !eventId) return;
    const subscription = repository.observeSync(eventId, setRow, () => setFailed(true));
    return () => subscription.unsubscribe();
  }, [cloud?.db, repository, eventId]);

  // The calendar does not exist without a connected actor's local repository.
  if (!cloud) return null;

  const pending = workoutHasDelta(row);
  const label = !eventId ? 'Не сохранено'
    : failed ? 'Ошибка'
    : !pending ? 'Синхронизирована'
    : cloud.syncStatus === 'offline' ? 'Нет соединения'
    : cloud.syncStatus === 'error' ? 'Ошибка' : 'В ожидании';
  const color = !eventId ? 'gray'
    : failed ? 'red'
    : !pending ? 'green'
    : cloud.syncStatus === 'offline' ? 'gray'
    : cloud.syncStatus === 'error' ? 'red' : 'yellow';
  const explanation = !eventId
    ? 'Новое событие ещё не сохранено на устройстве. Нажмите «Создать событие», чтобы запланировать его.'
    : label === 'Синхронизирована' ? 'Изменения сохранены в Mezfit облаке.'
    : label === 'Нет соединения' ? 'Событие сохранено на устройстве и отправится в облако при восстановлении соединения.'
    : label === 'Ошибка' ? 'Не удалось синхронизировать событие с облаком. Оно сохранено на устройстве.'
    : 'Событие сохранено на устройстве и ожидает синхронизации с облаком.';

  return <div className="personal-event-sheet__statuses" aria-label="Статусы личного события">
    <div className="occurrence-sync-status" role="status" aria-label="Статус синхронизации события">
      {eventId
        ? <LiquidPopover isOpen={opened} onOpenChange={setOpened} triggerRef={trigger}
            label="О синхронизации события" text={explanation}
            preset={glass.preset} optics={glass.optics}
            trigger={<button type="button" ref={trigger} className="occurrence-sync-status__badge"
              aria-label={`О статусе: ${label}`}>
              <Badge color={color} textVariant="caption">{label}</Badge>
            </button>} />
        : <Badge color={color} textVariant="caption" title={explanation}>{label}</Badge>}
    </div>
    <Badge color={eventId ? 'green' : 'yellow'} textVariant="caption">
      {eventId ? 'Запланировано' : 'Черновик'}
    </Badge>
  </div>;
}
