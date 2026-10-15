import { useEffect, useMemo, useRef, useState } from 'react';
import { List as KonstaList, ListInput, ListItem as KonstaListItem, Radio } from 'konsta/react';
import type { CloudTrainingPlanRow, CloudProgramStatus } from '../data/cloud/database';
import type { CloudContact, CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { athleteOf, isOtherActiveProgramInScope, type ProgramManagementRepository } from '../data/cloud/program-management';
import { useNavigationFloatingAction } from '../NavigationShell';
import { loadBrowserGlassSettings } from '../glassSettings';
import {
  Avatar, Badge, Button, GlassSurface, IconButton, LiquidPopover, List, ListItem,
  MezfitDialog, MezfitDialogButton, SearchInput, Tabs, TabsList, TabsTrigger, Text,
  type BadgeColor, type LiquidPopoverItem,
} from '../ui';
import { PlanActionDialog, type PlanDialogOption, type PlanDialogState } from './PlanActionDialog';
import './cloud-plan-management.css';

const STATES: readonly PlanDialogOption[] = [
  { value: 'active', label: 'Активная' },
  { value: 'finished', label: 'Завершена' },
  { value: 'draft', label: 'Черновик' },
  { value: 'cancelled', label: 'Отменена' },
];
const INACTIVE: readonly PlanDialogOption[] = STATES.filter((s) => s.value !== 'active');
type Filter = 'all' | CloudProgramStatus;
function label(status: CloudProgramStatus): { text: string; color: BadgeColor } {
  switch (status) {
    case 'active': return { text: 'Активная', color: 'green' };
    case 'finished': return { text: 'Завершена', color: 'blue' };
    case 'cancelled': return { text: 'Отменена', color: 'red' };
    case 'draft': return { text: 'Черновик', color: 'gray' };
  }
}

function ProgramRow({
  plan, busy, onOpen, onAction,
}: {
  plan: CloudTrainingPlanRow;
  busy: boolean;
  onOpen: (plan: CloudTrainingPlanRow) => void;
  onAction: (action: string, plan: CloudTrainingPlanRow) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const glass = loadBrowserGlassSettings();
  const entries: LiquidPopoverItem[] = ([
    { id: 'rename', label: 'Переименовать', icon: 'pencil' },
    { id: 'duplicate', label: 'Дублировать', icon: 'copy' },
    { id: 'delete', label: 'Удалить', icon: 'trash' },
    ...(plan.status === 'active' ? [] : [
      { id: 'activate', label: 'Сделать активной', icon: 'check' as const },
    ]),
    { id: 'status', label: 'Сменить статус', icon: 'edit' },
    { id: 'statistics', label: 'Статистика', icon: 'chart-dots-2' },
  ] satisfies LiquidPopoverItem[]).map((entry) => ({
    ...entry,
    disabled: busy || entry.id === 'statistics',
    onSelect: () => { setOpen(false); onAction(entry.id, plan); },
  }));
  const status = label(plan.status);
  return (
    <div className="cloud-plan-program-row">
      <div className="cloud-plan-program-main">
        <ListItem
          title={plan.name}
          subtitle="Программа тренировок"
          trailing={<Badge color={status.color}>{status.text}</Badge>}
          onClick={() => onOpen(plan)}
          disabled={busy}
        />
      </div>
      <LiquidPopover isOpen={open} onOpenChange={setOpen}
        triggerRef={triggerRef}
        trigger={<IconButton ref={triggerRef} icon="dots-vertical"
          label={`Меню программы ${plan.name}`} disabled={busy} />}
        label={`Меню программы ${plan.name}`}
        preset={glass.preset} optics={glass.optics}
        items={entries}
      />
    </div>
  );
}

export function CloudProgramsPage({
  repository, clients, onOpen, cloudStatus, cloudError, syncStatus, syncError,
  onRetryCloud, onRetrySync, personalOnly = false,
}: {
  repository: ProgramManagementRepository;
  clients: readonly CloudContact[];
  onOpen: (plan: CloudTrainingPlanRow) => void;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetryCloud: () => Promise<void>;
  onRetrySync: () => Promise<void>;
  personalOnly?: boolean;
}) {
  const [programs, setPrograms] = useState<CloudTrainingPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAthlete, setCreateAthlete] = useState(repository.actorUserId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const onChange = (rows: CloudTrainingPlanRow[]) => {
      if (!active) return;
      setPrograms(rows);
      setLoading(false);
      setError('');
    };
    const onError = (reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить программы');
      setLoading(false);
    };
    const subscription = personalOnly
      ? repository.observePersonal(onChange, onError)
      : repository.observeAuthored(onChange, onError);
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, retryKey, personalOnly]);

  const syncWarning = syncStatus === 'error'
    ? syncError || 'Ошибка синхронизации с Dexie Cloud'
    : syncStatus === 'offline'
      ? syncError || 'Нет соединения с Dexie Cloud'
      : syncStatus === 'pending'
        ? 'Синхронизация с облаком ещё не подтверждена.' : '';
  const needsRetry = Boolean(error) || cloudStatus === 'error'
    || syncStatus === 'error' || syncStatus === 'offline';

  const groups = useMemo(() => {
    const byAthlete = new Map<string, CloudTrainingPlanRow[]>();
    for (const plan of programs) {
      if (personalOnly && !(plan.realmId === repository.actorUserId
        && plan.athleteUserId === repository.actorUserId
        && plan.coachUserId === null && plan.clientUserId === null)) continue;
      if (filter !== 'all' && plan.status !== filter) continue;
      const athlete = athleteOf(plan);
      if (!athlete) continue;
      const group = byAthlete.get(athlete) ?? [];
      group.push(plan);
      byAthlete.set(athlete, group);
    }
    return [...byAthlete].map(([athleteId, plans]) => ({
      athleteId,
      athleteName: athleteId === repository.actorUserId
        ? 'Мои программы'
        : clients.find((client) => client.userId === athleteId)?.displayName ?? 'Атлет',
      plans,
    })).filter((group) => group.athleteName.toLocaleLowerCase('ru-RU')
      .includes(search.trim().toLocaleLowerCase('ru-RU')) || group.plans.some((plan) =>
        plan.name.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'))));
  }, [programs, filter, search, clients, repository.actorUserId, personalOnly]);

  const floatingAction = useMemo(() => ({
    label: 'Создать программу', icon: 'text-plus' as const,
    onClick: () => {
      setCreateName('');
      setCreateAthlete(repository.actorUserId);
      setCreateOpen(true);
      setError('');
    },
  }), [repository.actorUserId]);
  useNavigationFloatingAction('programs', floatingAction);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await fn(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const name = createName.trim();
      if (!name || name.length > 120) throw new Error('Введите название программы');
      if (createAthlete === repository.actorUserId) await repository.createPersonal(name);
      else await repository.createAssigned(createAthlete, name);
      setCreateOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать программу');
    } finally { setBusy(false); }
  };
  const requestActivation = async (plan: CloudTrainingPlanRow) => {
    if (plan.status === 'active') {
      setDialog(null);
      return;
    }
    const details = await repository.details(plan.id);
    if (!details || details.phases.length === 0) {
      setDialog(null);
      setError('Добавьте хотя бы одну фазу перед активацией программы');
      return;
    }
    setDialog({
      kind: 'select', title: 'Выберите фазу для активации',
      options: details.phases.map((phase) => ({ value: phase.id, label: phase.name })),
      onConfirm: async (phaseId) => {
        const active = programs.find((item) => isOtherActiveProgramInScope(item, plan));
        if (active) {
          setDialog({
            kind: 'select', title: 'Выберите статус для текущей активной программы',
            options: INACTIVE,
            onConfirm: async (value) => {
              await repository.activate(plan.id, phaseId, {
                previousProgramStatus: value as 'draft' | 'finished' | 'cancelled',
              });
              setDialog(null);
            },
          });
        } else {
          await repository.activate(plan.id, phaseId);
          setDialog(null);
        }
      },
    });
  };
  const action = (key: string, plan: CloudTrainingPlanRow) => {
    if (busy) return;
    if (key === 'rename') setDialog({
      kind: 'text', title: 'Переименовать программу', initial: plan.name,
      onConfirm: async (value) => { await repository.renameProgram(plan.id, value); setDialog(null); },
    });
    if (key === 'duplicate') void run(() => repository.duplicateProgram(plan.id));
    if (key === 'delete') setDialog({
      kind: 'confirm', title: 'Удалить программу?', destructive: true,
      description: 'Программа и её фазы без дней будут удалены. Программу с днями удалить пока нельзя.',
      confirmLabel: 'Удалить',
      onConfirm: async () => { await repository.deleteProgram(plan.id); setDialog(null); },
    });
    if (key === 'activate') void requestActivation(plan).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Не удалось выбрать фазу'));
    if (key === 'status') setDialog({
      kind: 'select', title: 'Сменить статус программы',
      initial: plan.status, options: STATES,
      onConfirm: async (value) => {
        if (value === 'active') await requestActivation(plan);
        else {
          await repository.setProgramStatus(plan.id, value as 'draft' | 'finished' | 'cancelled');
          setDialog(null);
        }
      },
    });
  };

  return (
    <section className="cloud-plan-list" aria-label="Программы">
      <SearchInput value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder="Поиск программы или атлета" />
      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList aria-label="Статус программы">
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="active">Активные</TabsTrigger>
          <TabsTrigger value="finished">Завершённые</TabsTrigger>
          <TabsTrigger value="draft">Черновики</TabsTrigger>
          <TabsTrigger value="cancelled">Отменённые</TabsTrigger>
        </TabsList>
      </Tabs>
      {loading || cloudStatus === 'loading' ? (
        <Text variant="footnote" tone="muted">Загружаем программы…</Text>
      ) : null}
      {!loading && cloudStatus === 'ready' && syncStatus === 'synced' && groups.length === 0 ? (
        <Text variant="footnote" tone="muted">Программ с выбранными параметрами нет</Text>
      ) : null}
      {groups.map((group) => (
        <section key={group.athleteId} className="cloud-plan-group">
          <Text variant="headline">{group.athleteName}</Text>
          <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-group-surface">
            <List>
              {group.plans.map((plan) => (
                <ProgramRow key={plan.id} plan={plan} busy={busy} onOpen={onOpen} onAction={action} />
              ))}
            </List>
          </GlassSurface>
        </section>
      ))}
      {error || cloudStatus === 'error' || syncWarning ? (
        <div className="cloud-plan-error">
          {error || cloudStatus === 'error' ? (
            <Text variant="footnote" role="alert">
              {error || cloudError || 'Не удалось загрузить облачные данные'}
            </Text>
          ) : null}
          {syncWarning ? (
            <>
              <Text variant="footnote" role={syncStatus === 'pending' ? 'status' : 'alert'}>
                {syncWarning}
              </Text>
              <Text variant="footnote" tone="muted">
                Изменения могут оставаться только на этом устройстве до завершения синхронизации.
              </Text>
            </>
          ) : null}
          {needsRetry ? (
            <Button variant="secondary" onClick={() => {
              void (async () => {
                if (cloudStatus === 'error') await onRetryCloud();
                if (syncStatus === 'error' || syncStatus === 'offline') await onRetrySync();
              })().catch(() => {}).finally(() => setRetryKey((n) => n + 1));
            }}>Повторить синхронизацию</Button>
          ) : null}
        </div>
      ) : null}
      <PlanActionDialog dialog={dialog} onClose={() => setDialog(null)} />
      <MezfitDialog
        opened={createOpen}
        title="Создать программу"
        onBackdropClick={!busy ? () => setCreateOpen(false) : undefined}
        role="dialog" aria-modal="true" aria-label="Создать программу"
        buttons={(
          <>
            <MezfitDialogButton disabled={busy} onClick={() => setCreateOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong disabled={busy || !createName.trim()}
              onClick={() => { void create(); }}>Сохранить</MezfitDialogButton>
          </>
        )}
      >
        <KonstaList nested>
          <ListInput floatingLabel inputId="cloud-plan-name" label="Название"
            value={createName} maxLength={120} disabled={busy}
            onChange={(event) => setCreateName(event.target.value)} />
          <KonstaListItem label link title="Моя программа"
            onClick={() => setCreateAthlete(repository.actorUserId)}
            after={<Radio component="div" checked={createAthlete === repository.actorUserId}
              onChange={() => setCreateAthlete(repository.actorUserId)} />} />
          {!personalOnly ? clients.map((client) => (
            <KonstaListItem key={client.userId} label link title={client.displayName}
              media={<Avatar name={client.displayName} />}
              onClick={() => setCreateAthlete(client.userId)}
              after={<Radio component="div" checked={createAthlete === client.userId}
                onChange={() => setCreateAthlete(client.userId)} />} />
          )) : null}
        </KonstaList>
        {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      </MezfitDialog>
    </section>
  );
}
