import { useRef, useState } from 'react';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { syncStatusLabel, syncStatusColor } from '../data/cloud/sync-status';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { loadBrowserGlassSettings } from '../glassSettings';
import { Badge, LiquidPopover, type BadgeColor } from '../ui';
import './fact-cloud-sync-status.css';

/** FACT uses the app-wide Dexie Cloud state; it has no per-session revision receipt. */
export function factCloudSyncPresentation(status: CloudSyncStatus): { label: string; color: BadgeColor; explanation: string } {
  const explanations: Record<CloudSyncStatus, string> = {
    local: 'Изменения хранятся на устройстве. Облачная синхронизация ещё не подтверждена.',
    syncing: 'Идёт отправка или получение изменений из Mezfit облака.',
    synced: 'Синхронизация с облаком Mezfit завершена.',
    error: 'Не удалось синхронизировать данные с облаком Mezfit. Изменения сохранены на устройстве.',
  };
  return { label: syncStatusLabel(status), color: syncStatusColor(status), explanation: explanations[status] };
}

export function FactCloudSyncStatus() {
  const cloud = useCloudConnections();
  const status = cloud?.syncStatus ?? 'local';
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
