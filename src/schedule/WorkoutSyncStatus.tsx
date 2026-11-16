import { useEffect, useRef, useState } from 'react';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { workoutHasDelta } from '../data/cloud/workout-sync';
import { itemSyncStatus, syncStatusLabel, syncStatusColor } from '../data/cloud/sync-status';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { Badge, LiquidPopover } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';

/** Presentation only: saving/editing never awaits a push or this observer. */
export function WorkoutSyncStatus({ draft, repository }: { draft: LocalWorkoutOccurrenceDraft; repository: WorkoutOccurrenceDraftRepository }) {
  const cloud = useCloudConnections();
  const [row, setRow] = useState<LocalProgramSyncRow>();
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  useEffect(() => {
    setRow(undefined); setFailed(false);
    if (!cloud || !draft.targetOccurrenceId) return;
    const subscription = repository.observeSync(draft.targetOccurrenceId, setRow, () => setFailed(true));
    return () => subscription.unsubscribe();
  }, [repository, draft.targetOccurrenceId]);
  const pending = workoutHasDelta(row);
  const sync = itemSyncStatus(!pending, failed, cloud?.syncStatus ?? 'local');
  const label = syncStatusLabel(sync);
  const color = syncStatusColor(sync);
  const explanation = ({
    synced: 'Изменения этой тренировки подтверждены в Mezfit облаке.',
    syncing: 'Идёт синхронизация изменений с Mezfit облаком.',
    local: 'Изменения сохранены на устройстве, но их отправка ещё не подтверждена.',
    error: 'Не удалось подтвердить изменения в Mezfit облаке. Они сохранены на устройстве.',
  }[sync]) + (!draft.saved ? ' Это черновик: клиент его не видит. «Сохранить» публикует тренировку; синхронизация работает автоматически.' : '');
  return <div className="occurrence-sync-status" role="status" aria-label="Статус синхронизации тренировки">
    <LiquidPopover isOpen={opened} onOpenChange={setOpened} triggerRef={trigger}
      label="О синхронизации тренировки" text={explanation} preset={glass.preset} optics={glass.optics}
      trigger={<button type="button" ref={trigger} className="occurrence-sync-status__badge" aria-label={`О статусе: ${label}`}>
        <Badge color={color} textVariant="caption">{label}</Badge>
      </button>} />
  </div>;
}
