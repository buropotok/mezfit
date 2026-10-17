import type { NavigationContext } from '../NavigationShell';
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { programHasDelta } from '../data/cloud/program-sync';
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
  const label = error ? 'Ошибка' : !pending ? 'Синхронизирована'
    : syncStatus === 'offline' ? 'Нет соединения'
      : syncStatus === 'error' ? 'Ошибка' : 'В ожидании';
  const color = error ? 'red' : !pending ? 'green' : syncStatus === 'offline' ? 'gray'
    : syncStatus === 'error' ? 'red' : 'yellow';
  const explanations = {
    'Синхронизирована': 'Изменения сохранены в Mezfit облаке. Клиент видит опубликованную программу и её доступные фазы.',
    'В ожидании': 'Изменения сохранены на этом устройстве. Клиент увидит их после синхронизации с Mezfit облаком.',
    'Ошибка': 'Не удалось отправить изменения в Mezfit облако. Они сохранены на устройстве. Повторите синхронизацию вручную.',
    'Нет соединения': 'Изменения сохранены на устройстве и пока недоступны клиенту. Для отправки в Mezfit облако нужно соединение.',
  };
  return <>
    <div className="program-sync-row">
      <div className="program-sync-status" role="status" aria-label="Статус синхронизации программы">
        <LiquidPopover isOpen={infoOpen} onOpenChange={setInfoOpen} triggerRef={infoRef}
          text={explanations[label]} label="О синхронизации программы" preset={glass.preset} optics={glass.optics}
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
