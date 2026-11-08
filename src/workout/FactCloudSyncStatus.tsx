import { useRef, useState } from 'react';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { loadBrowserGlassSettings } from '../glassSettings';
import { Badge, LiquidPopover, type BadgeColor } from '../ui';
import './fact-cloud-sync-status.css';

/** FACT uses the app-wide Dexie Cloud state; it has no per-session revision receipt. */
export function factCloudSyncPresentation(status: CloudSyncStatus): { label: string; color: BadgeColor; explanation: string } {
  const caveat = ' Это общее состояние Dexie Cloud, а не отдельное подтверждение изменений этой тренировки.';
  switch (status) {
    case 'synced':
      return { label: 'Синхронизировано', color: 'green',
        explanation: 'Очередь синхронизации приложения обработана.' + caveat };
    case 'offline':
      return { label: 'Нет соединения', color: 'gray',
        explanation: 'Облако недоступно. Изменения сохраняются на устройстве и отправятся при восстановлении соединения.' + caveat };
    case 'error':
      return { label: 'Ошибка', color: 'red',
        explanation: 'При обмене данными с облаком произошла ошибка. Локально сохранённые изменения остаются на устройстве.' + caveat };
    case 'pending':
      return { label: 'В ожидании', color: 'yellow',
        explanation: 'Приложение ожидает завершения синхронизации с облаком.' + caveat };
  }
}

export function FactCloudSyncStatus() {
  const cloud = useCloudConnections();
  const status = cloud?.syncStatus ?? 'pending';
  const { label, color, explanation } = factCloudSyncPresentation(status);
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  return <div className="fact-cloud-sync-status" role="status" aria-label="Состояние синхронизации приложения">
    <LiquidPopover isOpen={opened} onOpenChange={setOpened} triggerRef={trigger}
      label="О синхронизации" text={explanation} preset={glass.preset} optics={glass.optics}
      trigger={<button type="button" ref={trigger} className="fact-cloud-sync-status__badge"
        aria-label={`Облако: ${label}`}>
        <Badge color={color} textVariant="caption">{label}</Badge>
      </button>} />
  </div>;
}
