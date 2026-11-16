import type { NavigationContext } from '../NavigationShell';
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { programHasDelta } from '../data/cloud/program-sync';
import { itemSyncStatus, syncStatusLabel, syncStatusColor } from '../data/cloud/sync-status';
import { Badge, GlassSurface, LiquidPopover, Text } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import { ProgramSyncDialog } from './ProgramSyncDialog';

function SyncButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} />;
}

export function ProgramSyncControls({ repository, planId, syncStatus, onSync, onNavigationContextChange }: {
  repository: ProgramManagementRepository;
  planId: string;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  syncStatus: CloudSyncStatus;
  onSync: () => Promise<void>;
}) {
  const [row, setRow] = useState<LocalProgramSyncRow>();
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  useEffect(() => {
    setRow(undefined);
    setError('');
    const subscription = repository.observeSync(planId, setRow, () => {
      setError('Не удалось определить, отправлены ли изменения в Mezfit облако.');
    });
    return () => subscription.unsubscribe();
  }, [repository, planId]);
  const pending = programHasDelta(row);
  const sync = itemSyncStatus(!pending, Boolean(error), syncStatus);
  const label = syncStatusLabel(sync);
  const color = syncStatusColor(sync);
  const explanations: Record<typeof sync, string> = {
    synced: 'Изменения программы подтверждены в Mezfit облаке. Клиент видит опубликованную программу и её доступные фазы.',
    syncing: 'Идёт синхронизация изменений программы с Mezfit облаком.',
    local: 'Изменения сохранены на устройстве, но их отправка в Mezfit облако ещё не подтверждена.',
    error: 'Не удалось отправить изменения в Mezfit облако. Они сохранены на устройстве. Повторите синхронизацию вручную.',
  };
  return <>
    <div className="program-sync-row">
      <div className="program-sync-status" role="status" aria-label="Статус синхронизации программы">
        <LiquidPopover isOpen={infoOpen} onOpenChange={setInfoOpen} triggerRef={infoRef}
          text={explanations[sync]} label="О синхронизации программы" preset={glass.preset} optics={glass.optics}
          trigger={<button type="button" ref={infoRef} className="program-sync-badge" aria-label={`О статусе: ${label}`}>
            <Badge color={color} textVariant="caption">{label}</Badge>
          </button>} />
      </div>
      <GlassSurface component={SyncButton} wrapContent={false} shape="capsule" preset="modalTuned"
        optics={false} blur={glass.blur} className="program-sync-button" onClick={() => setOpened(true)}>
        <Text variant="body">Синхронизировать</Text>
      </GlassSurface>
    </div>
    <ProgramSyncDialog opened={opened} onClose={() => setOpened(false)} onSync={onSync} onNavigationContextChange={onNavigationContextChange} />
  </>;
}
