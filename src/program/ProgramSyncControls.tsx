import type { NavigationContext } from '../NavigationShell';
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { programHasDelta } from '../data/cloud/program-sync';
import { Badge, GlassSurface, IconButton, LiquidPopover, Text } from '../ui';
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
    const subscription = repository.observeSync(planId, setRow, reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать статус синхронизации');
    });
    return () => subscription.unsubscribe();
  }, [repository, planId]);
  const pending = programHasDelta(row);
  const label = error ? 'Ошибка' : !pending ? 'Синхронизирована'
    : syncStatus === 'offline' ? 'Нет соединения'
      : syncStatus === 'error' ? 'Ошибка' : 'В ожидании';
  const color = error ? 'red' : !pending ? 'green' : syncStatus === 'offline' ? 'gray'
    : syncStatus === 'error' ? 'red' : 'yellow';
  return <>
    <div className="program-sync-status" role="status" aria-label="Статус синхронизации программы">
      <Badge color={color}>{label}</Badge>
      <LiquidPopover isOpen={infoOpen} onOpenChange={setInfoOpen} triggerRef={infoRef}
        text="Чтобы клиент видел изменения, программа должна быть синхронизирована с облаком."
        label="О синхронизации программы" preset={glass.preset} optics={glass.optics}
        trigger={<IconButton ref={infoRef} icon="info-circle" label="О синхронизации программы" />} />
    </div>
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    <div className="program-sync-actions">
      <GlassSurface component={SyncButton} wrapContent={false} shape="capsule" preset="modalTuned"
        optics={false} blur={glass.blur} className="program-sync-button" onClick={() => setOpened(true)}>
        <Text variant="body">Синхронизировать</Text>
      </GlassSurface>
    </div>
    <ProgramSyncDialog opened={opened} onClose={() => setOpened(false)} onSync={onSync} onNavigationContextChange={onNavigationContextChange} />
  </>;
}
