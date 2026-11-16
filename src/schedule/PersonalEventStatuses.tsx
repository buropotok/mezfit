import { useEffect, useRef, useState } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { PersonalEventRepository } from '../data/cloud/personal-events';
import { workoutHasDelta } from '../data/cloud/workout-sync';
import { itemSyncStatus, syncStatusLabel, syncStatusColor } from '../data/cloud/sync-status';
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
  const sync = itemSyncStatus(!pending, failed, cloud.syncStatus);
  const label = !eventId ? 'Не сохранено' : syncStatusLabel(sync);
  const color = !eventId ? 'gray' : syncStatusColor(sync);
  const explanation = !eventId
    ? 'Новое событие ещё не сохранено на устройстве. Нажмите «Создать событие», чтобы запланировать его.'
    : ({
      synced: 'Изменения этого события подтверждены в Mezfit облаке.',
      syncing: 'Идёт синхронизация события с Mezfit облаком.',
      local: 'Событие сохранено на устройстве, но его отправка ещё не подтверждена.',
      error: 'Не удалось синхронизировать событие с облаком. Оно сохранено на устройстве.',
    }[sync]);
  return <div className="personal-event-sheet__statuses" aria-label="Статусы личного события">
    <div className="personal-event-sheet__sync" role="status" aria-label="Статус синхронизации события">
      {eventId
        ? <LiquidPopover isOpen={opened} onOpenChange={setOpened} triggerRef={trigger}
            label="О синхронизации события" text={explanation}
            preset={glass.preset} optics={glass.optics}
            trigger={<button type="button" ref={trigger} className="personal-event-sheet__sync-badge"
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
