import { useEffect, useRef, useState } from 'react';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { workoutHasDelta } from '../data/cloud/workout-sync';
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
  // Private draft content intentionally stays on the device and is not yet published.
  const pending = !draft.saved || workoutHasDelta(row);
  const label = failed ? 'Ошибка' : !pending ? 'Синхронизирована'
    : cloud?.syncStatus === 'offline' ? 'Нет соединения'
    : cloud?.syncStatus === 'error' ? 'Ошибка' : 'В ожидании';
  const color = failed ? 'red' : !pending ? 'green' : cloud?.syncStatus === 'offline' ? 'gray'
    : cloud?.syncStatus === 'error' ? 'red' : 'yellow';
  const explanation = !draft.saved
    ? 'Черновик сохранён на этом устройстве и виден только вам. Нажмите «Сохранить», чтобы опубликовать тренировку. После этого изменения отправятся в Mezfit облако автоматически.'
    : label === 'Синхронизирована' ? 'Изменения сохранены в Mezfit облаке.'
    : label === 'Нет соединения' ? 'Изменения сохранены на устройстве и отправятся в Mezfit облако после восстановления соединения.'
    : label === 'Ошибка' ? 'Не удалось синхронизировать изменения с Mezfit облаком. Они сохранены на устройстве, работу можно продолжать.'
    : 'Изменения сохранены на устройстве и ожидают синхронизации с Mezfit облаком.';
  return <div className="occurrence-sync-status" role="status" aria-label="Статус синхронизации тренировки">
    <LiquidPopover isOpen={opened} onOpenChange={setOpened} triggerRef={trigger}
      label="О синхронизации тренировки" text={explanation} preset={glass.preset} optics={glass.optics}
      trigger={<button type="button" ref={trigger} className="occurrence-sync-status__badge" aria-label={`О статусе: ${label}`}>
        <Badge color={color} textVariant="caption">{label}</Badge>
      </button>} />
  </div>;
}
