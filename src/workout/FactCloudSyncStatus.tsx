import { useRef, useState } from 'react';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { loadBrowserGlassSettings } from '../glassSettings';
import { Badge, LiquidPopover, type BadgeColor } from '../ui';
import './fact-cloud-sync-status.css';

/** FACT uses the app-wide Dexie Cloud state; it has no per-session revision receipt. */
export function factCloudSyncPresentation(status: CloudSyncStatus): { label: string; color: BadgeColor; explanation: string } {
  switch (status) {
    case 'synced':
      return { label: 'Синхронизировано', color: 'green',
        explanation: 'Синхронизация с облаком Mezfit завершена.' };
    case 'offline':
      return { label: 'Нет соединения', color: 'gray',
        explanation: 'Нет соединения с облаком Mezfit. Изменения сохраняются на устройстве и синхронизируются после подключения к интернету.' };
    case 'error':
      return { label: 'Ошибка', color: 'red',
        explanation: 'Не удалось синхронизировать данные с облаком Mezfit. Изменения сохранены на устройстве.' };
    case 'pending':
      return { label: 'В ожидании', color: 'yellow',
        explanation: 'Ожидается синхронизация с облаком Mezfit.' };
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
