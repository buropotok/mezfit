import { useEffect, useMemo, useRef, useState } from 'react';
import { List as KonstaList, ListInput, ListItem as KonstaListItem, Radio } from 'konsta/react';
import type { CloudTrainingPlanRow, CloudProgramStatus } from '../data/cloud/database';
import type { CloudContact, CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { isOtherActiveProgramInScope, type ProgramManagementRepository } from '../data/cloud/program-management';
import { useNavigationFloatingAction, type NavigationContext } from '../NavigationShell';
import { loadBrowserGlassSettings } from '../glassSettings';
import {
  Badge, GlassSurface, IconButton, LiquidPopover, List, ListItem,
  MezfitDialog, MezfitDialogButton, Text,
  type BadgeColor, type LiquidPopoverItem,
} from '../ui';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { ProgramClientPicker } from './ProgramClientPicker';
import { ProgramToolbar, type ProgramControls } from './ProgramToolbar';
import { PlanSyncNotice } from './PlanSyncNotice';
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
  plan, busy, readOnly, onOpen, onAction,
}: {
  plan: CloudTrainingPlanRow;
  busy: boolean;
  readOnly: boolean;
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
      {!readOnly ? <LiquidPopover isOpen={open} onOpenChange={setOpen}
        triggerRef={triggerRef}
        trigger={<IconButton ref={triggerRef} icon="dots-vertical"
          label={`Меню программы ${plan.name}`} disabled={busy} />}
        label={`Меню программы ${plan.name}`}
        preset={glass.preset} optics={glass.optics}
        items={entries}
      /> : null}
    </div>
  );
}

export function CloudProgramsPage({
  repository, clients, onOpen, cloudStatus, cloudError, syncStatus, syncError,
  onRetryCloud, onRetrySync, personalOnly = false, controls, hideToolbar = false,
  viewerRole = 'coach', coaches = [], onNavigationContextChange,
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
  viewerRole?: 'coach' | 'client';
  coaches?: readonly CloudContact[];
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  personalOnly?: boolean;
  controls?: ProgramControls;
  hideToolbar?: boolean;
}) {
  const [programs, setPrograms] = useState<CloudTrainingPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localFilter, setLocalFilter] = useState<Filter>('all');
  const [localSearch, setLocalSearch] = useState('');
  const filter = controls?.filter ?? localFilter;
  const search = controls?.search ?? localSearch;
  const toolbarControls: ProgramControls = controls ?? {
    filter: localFilter, onFilterChange: setLocalFilter, search: localSearch, onSearchChange: setLocalSearch,
  };
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createNameError, setCreateNameError] = useState(false);
  const [createAthlete, setCreateAthlete] = useState(repository.actorUserId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPrograms([]);
    setError('');
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
    const subscription = viewerRole === 'client'
      ? repository.observeForAthlete(onChange, onError)
      : personalOnly
      ? repository.observePersonal(onChange, onError)
      : repository.observeAuthored(onChange, onError);
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, retryKey, personalOnly, viewerRole]);

  const personal = programs.filter((plan) => plan.coachUserId === null && plan.clientUserId === null
    && plan.realmId === repository.actorUserId && plan.athleteUserId === repository.actorUserId);
  const matches = (plan: CloudTrainingPlanRow) => filter === 'all' || plan.status === filter;
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const personalVisible = personal.filter((plan) => matches(plan)
    && plan.name.toLocaleLowerCase('ru-RU').includes(query));
  const groups = useMemo(() => {
    const byRealm = new Map<string, CloudTrainingPlanRow[]>();
    for (const plan of programs) {
      if (!plan.coachUserId || !plan.clientUserId || (filter !== 'all' && plan.status !== filter)) continue;
      if (viewerRole === 'client' && (plan.clientUserId !== repository.actorUserId || plan.status === 'draft')) continue;
      const rows = byRealm.get(plan.realmId) ?? [];
      rows.push(plan);
      byRealm.set(plan.realmId, rows);
    }
    const contacts = viewerRole === 'client' ? coaches : clients;
    return [...byRealm].map(([realmId, plans]) => {
      const personId = viewerRole === 'client' ? plans[0].coachUserId : plans[0].clientUserId;
      const contact = contacts.find((person) => person.relationshipId === realmId && person.userId === personId);
      const personName = contact?.displayName ?? (viewerRole === 'client' ? 'Тренер' : 'Атлет');
      return { realmId, personName, contact, plans: personName.toLocaleLowerCase('ru-RU').includes(query)
        ? plans : plans.filter((plan) => plan.name.toLocaleLowerCase('ru-RU').includes(query)) };
    }).filter((group) => group.plans.length > 0);
  }, [programs, filter, query, clients, coaches, viewerRole, repository.actorUserId]);

  useEffect(() => {
    if (!onNavigationContextChange) return;
    onNavigationContextChange(createOpen ? {
      title: pickerOpen ? 'Выбрать клиента' : 'Создать программу',
      scrollKey: pickerOpen ? 'program-client-picker' : 'program-create',
      onBack: () => { if (!busy) { if (pickerOpen) setPickerOpen(false); else setCreateOpen(false); } },
    } : null);
    return () => onNavigationContextChange(null);
  }, [createOpen, pickerOpen, busy, onNavigationContextChange]);

  const selectedClient = clients.find((client) => client.userId === createAthlete);

  const floatingAction = useMemo(() => ({
    label: 'Создать программу', icon: 'text-plus' as const,
    onClick: () => {
      setCreateName('');
      setPickerOpen(false);
      setCreateNameError(false);
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
    const name = createName.trim();
    if (!name) {
      setCreateNameError(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (name.length > 120) throw new Error('Введите название программы');
      if (viewerRole === 'client' || createAthlete === repository.actorUserId) await repository.createPersonal(name);
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
    const activatePhase = async (phaseId: string) => {
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
    };
    if (details.phases.length === 1) {
      await activatePhase(details.phases[0].id);
    } else {
      setDialog({
        kind: 'select', title: 'Выберите фазу для активации',
        options: details.phases.map((phase) => ({ value: phase.id, label: phase.name })),
        onConfirm: activatePhase,
      });
    }
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
      description: 'Программа, фазы и дни будут удалены из списка. История выполненных тренировок сохранится.',
      confirmLabel: 'Удалить',
      onConfirm: async () => { await repository.deleteProgram(plan.id); setDialog(null); },
    });
    if (key === 'activate') void run(() => requestActivation(plan));
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
      {!hideToolbar ? <ProgramToolbar controls={toolbarControls} showSearch={viewerRole === 'coach'} /> : null}
      {loading || cloudStatus === 'loading' ? (
        <Text variant="footnote" tone="muted">Загружаем программы…</Text>
      ) : null}
      <section className="cloud-plan-group" aria-label="Мои программы">
        <Text variant="headline" role="heading" aria-level={2}>Мои программы</Text>
        {personalVisible.length ? <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-group-surface">
          <div className="cloud-plan-group-content"><List>{personalVisible.map((plan) => (
            <ProgramRow key={plan.id} plan={plan} busy={busy} readOnly={false} onOpen={onOpen} onAction={action} />
          ))}</List></div>
        </GlassSurface> : !loading && !error && cloudStatus === 'ready' ? <Text variant="body">
          {personal.length ? 'Программ с выбранными параметрами нет' : 'Мы не создали ни одной личной программы'}
        </Text> : null}
      </section>
      {!personalOnly ? <section className="cloud-plan-group" aria-label={viewerRole === 'client' ? 'Тренерские программы' : 'Программы клиентов'}>
        <Text variant="headline" role="heading" aria-level={2}>{viewerRole === 'client' ? 'Тренерские программы' : 'Программы клиентов'}</Text>
        {groups.map((group) => (
          <section key={group.realmId} className="cloud-plan-group" aria-label={group.personName}>
            <div className="cloud-plan-person-row">
              {group.contact ? <CloudContactAvatar contact={group.contact} /> : null}
              <Text variant="headline" role="heading" aria-level={3}>{group.personName}</Text>
            </div>
            <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-group-surface">
              <div className="cloud-plan-group-content"><List>{group.plans.map((plan) => (
                <ProgramRow key={plan.id} plan={plan} busy={busy} readOnly={viewerRole === 'client'} onOpen={onOpen} onAction={action} />
              ))}</List></div>
            </GlassSurface>
          </section>
        ))}
        {!groups.length && !loading && !error && cloudStatus === 'ready' && syncStatus === 'synced'
          ? <Text variant="body">Программ с выбранными параметрами нет</Text> : null}
      </section> : null}
      <PlanSyncNotice cloudStatus={cloudStatus} cloudError={cloudError}
        syncStatus={syncStatus} syncError={syncError}
        onRetryCloud={onRetryCloud} onRetrySync={onRetrySync}
        localError={error} onRetryLocal={() => setRetryKey((n) => n + 1)} />
      <PlanActionDialog dialog={dialog} onClose={() => setDialog(null)} />
      <MezfitDialog
        opened={createOpen && !pickerOpen}
        title="Создать программу"
        onBackdropClick={!busy ? () => setCreateOpen(false) : undefined}
        role="dialog" aria-modal="true" aria-label="Создать программу"
        buttons={(
          <>
            <MezfitDialogButton disabled={busy} onClick={() => setCreateOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong disabled={busy}
              onClick={() => { void create(); }}>Сохранить</MezfitDialogButton>
          </>
        )}
      >
        <KonstaList nested>
          <ListInput floatingLabel inputId="cloud-plan-name" required
            label={<label htmlFor="cloud-plan-name"><Text variant="footnote">Название</Text></label>}
            value={createName} maxLength={120} disabled={busy}
            error={createNameError ? 'Обязательно к заполнению' : undefined}
            onChange={(event) => { setCreateName(event.target.value); setCreateNameError(false); }} />
          <KonstaListItem label link title="Моя программа"
            onClick={() => setCreateAthlete(repository.actorUserId)}
            after={<Radio component="div" checked={createAthlete === repository.actorUserId}
              onChange={() => setCreateAthlete(repository.actorUserId)} />} />
          {!personalOnly && viewerRole === 'coach' ? <KonstaListItem link title="Выбрать клиента"
            subtitle={selectedClient?.displayName}
            media={selectedClient ? <CloudContactAvatar contact={selectedClient} /> : undefined}
            onClick={() => setPickerOpen(true)} /> : null}
        </KonstaList>
        {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      </MezfitDialog>
      {pickerOpen ? <ProgramClientPicker clients={clients} loading={cloudStatus === 'loading'}
        onClose={() => setPickerOpen(false)} onSelect={(client) => {
          setCreateAthlete(client.userId); setPickerOpen(false);
        }} /> : null}
    </section>
  );
}
