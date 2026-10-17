import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { List as KonstaList, ListInput } from 'konsta/react';
import type { CloudProgramPhaseRow } from '../data/cloud/workout-foundation-types';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { isOtherActiveProgramInScope, type ProgramDetails, type ProgramManagementRepository } from '../data/cloud/program-management';
import { useNavigationSurfaceFloatingAction, type NavigationContext } from '../NavigationShell';
import { Badge, Button, Icon, IconButton, LiquidPopover, MezfitDialog, MezfitDialogButton, Text, type BadgeColor, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import { ProgramSummary, type ProgramActor } from './ProgramSummary';
import { programMutationMessage, weekLabel } from './programPresentation';
import { ProgramPhaseDays } from './ProgramPhaseDays';
import { ProgramDayDialog } from './ProgramDayDialog';
import { PlanSyncNotice } from './PlanSyncNotice';
import { PlanActionDialog, type PlanDialogState, type PlanDialogOption } from './PlanActionDialog';
import './cloud-plan-management.css';

const INACTIVE: readonly PlanDialogOption[] = [
  { value: 'finished', label: 'Завершена' },
  { value: 'draft', label: 'Черновик' },
  { value: 'cancelled', label: 'Отменена' },
];
const PHASE_STATUSES: readonly PlanDialogOption[] = [
  { value: 'active', label: 'Активная' },
  { value: 'finished', label: 'Завершена' },
  { value: 'pending', label: 'В ожидании' },
  { value: 'draft', label: 'Черновик' },
  { value: 'cancelled', label: 'Отменена' },
];
function status(phase: CloudProgramPhaseRow): { label: string; color: BadgeColor } {
  switch (phase.status) {
    case 'active': return { label: 'Активная', color: 'green' };
    case 'finished': return { label: 'Завершена', color: 'blue' };
    case 'pending': return { label: 'В ожидании', color: 'yellow' };
    case 'cancelled': return { label: 'Отменена', color: 'red' };
    case 'draft': return { label: 'Черновик', color: 'gray' };
  }
}

function PhaseHeading({
  phase, disabled, readOnly, onAction, onPublish, children,
}: {
  children?: (collapsed: boolean, bodyId: string) => ReactNode;
  phase: CloudProgramPhaseRow;
  disabled: boolean;
  readOnly: boolean;
  onAction: (action: string, phase: CloudProgramPhaseRow) => void;
  onPublish: (phase: CloudProgramPhaseRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toggled, setToggled] = useState(false);
  const bodyId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  const menu: LiquidPopoverItem[] = ([
    { id: 'rename', label: 'Переименовать', icon: 'pencil' },
    { id: 'weeks', label: 'Изменить длительность', icon: 'clock' },
    { id: 'duplicate', label: 'Дублировать', icon: 'copy' },
    { id: 'delete', label: 'Удалить', icon: 'trash' },
    ...(phase.status === 'active' ? [] : [
      { id: 'activate', label: 'Сделать активной', icon: 'check' as const },
    ]),
    { id: 'status', label: 'Сменить статус', icon: 'edit' },
  ] satisfies LiquidPopoverItem[]).map((item) => ({
    ...item, disabled,
    onSelect: () => { setOpen(false); onAction(item.id, phase); },
  }));
  const label = status(phase);
  const weeks = phase.durationWeeks ?? 10;
  return (
    <section className="cloud-plan-phase" aria-label={phase.name}>
      <div className="cloud-plan-phase-heading">
        <div className="cloud-plan-phase-title"><Text variant="headline">{phase.name}</Text></div>
        <Badge color={label.color}>{label.label}</Badge>
        <Text variant="footnote" className="cloud-plan-phase-weeks">{weeks} {weekLabel(weeks)}</Text>
        <div className="cloud-plan-phase-controls">
          <IconButton label={collapsed ? `Развернуть фазу ${phase.name}` : `Свернуть фазу ${phase.name}`}
            aria-expanded={!collapsed} aria-controls={bodyId}
            onPointerDown={event => event.preventDefault()} onClick={() => { setToggled(true); setCollapsed(value => !value); }}>
            <span key={String(collapsed)} className={`cloud-plan-phase-chevron ${toggled ? 'has-toggled' : ''} ${collapsed ? 'is-collapsed' : 'is-expanded'}`}>
              <Icon name="chevron-right" />
            </span>
          </IconButton>
          {!readOnly ? <LiquidPopover
            isOpen={open}
            onOpenChange={setOpen}
            triggerRef={triggerRef}
            trigger={<IconButton ref={triggerRef} icon="dots-vertical"
              label={`Действия с фазой ${phase.name}`} />}
            items={menu}
            label={`Действия с фазой ${phase.name}`}
            preset={glass.preset}
            optics={glass.optics}
          /> : null}
        </div>
      </div>
      {children?.(collapsed, bodyId)}
      {!readOnly && phase.status === 'draft' ? (
        <Button variant="secondary" disabled={disabled} onClick={() => onPublish(phase)}>
          Завершить заполнение фазы
        </Button>
      ) : null}
    </section>
  );
}

export function CloudProgramDetailsPage({
  repository, planId, viewerRole = 'coach', readOnly = false, actor, cloudStatus, cloudError, syncStatus, syncError, onRetryCloud, onRetrySync, onNavigationContextChange,
}: {
  repository: ProgramManagementRepository;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  planId: string;
  viewerRole?: 'coach' | 'client';
  readOnly?: boolean;
  actor?: ProgramActor;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetryCloud: () => Promise<void>;
  onRetrySync: () => Promise<void>;
}) {
  const coachGuidance = viewerRole === 'coach';
  const [details, setDetails] = useState<ProgramDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const [phaseCreateOpen, setPhaseCreateOpen] = useState(false);
  const [phaseName, setPhaseName] = useState('');
  const [phaseNameRequired, setPhaseNameRequired] = useState(false);
  const [phaseCreateBusy, setPhaseCreateBusy] = useState(false);
  const [phaseCreateError, setPhaseCreateError] = useState('');
  const [dayCreatePhaseId, setDayCreatePhaseId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetails(null);
    setDialog(null);
    setPhaseCreateOpen(false);
    setDayCreatePhaseId(null);
    setError('');
    const observe = readOnly ? repository.observeAthleteDetails.bind(repository) : repository.observeDetails.bind(repository);
    const subscription = observe(planId, (value) => {
      if (!active) return;
      setDetails(value);
      setLoading(false);
    }, (reason) => {
      if (!active) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть программу');
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, planId, retryKey, readOnly]);

  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (busy || readOnly) return;
    setBusy(true);
    setError('');
    try { await task(); }
    catch (reason) {
      setError(programMutationMessage(reason));
    } finally { setBusy(false); }
  }, [busy, readOnly]);

  const addPhase = useCallback(() => {
    setPhaseName('');
    setPhaseNameRequired(false);
    setPhaseCreateError('');
    setPhaseCreateOpen(true);
  }, []);
  const savePhase = async () => {
    if (readOnly || busy || phaseCreateBusy) return;
    const name = phaseName.trim();
    if (!name) {
      setPhaseNameRequired(true);
      return;
    }
    setPhaseCreateBusy(true);
    setPhaseCreateError('');
    setError('');
    try {
      await repository.createPhase(planId, name);
      setPhaseCreateOpen(false);
    } catch (reason) {
      const message = programMutationMessage(reason);
      setPhaseCreateError(message);
    } finally {
      setPhaseCreateBusy(false);
    }
  };
  const addDay = useCallback(() => {
    if (!details || readOnly || busy || phaseCreateBusy) return;
    if (details.phases.length === 1) setDayCreatePhaseId(details.phases[0].id);
    else if (details.phases.length > 1) setDialog({
      kind: 'select', title: 'Выберите фазу',
      options: details.phases.map((phase) => ({ value: phase.id, label: phase.name })),
      onConfirm: async (phaseId) => { setDialog(null); setDayCreatePhaseId(phaseId); },
    });
  }, [details, readOnly, busy, phaseCreateBusy]);
  const floatingAction = useMemo(() => details && !readOnly ? {
    label: 'Добавить',
    icon: 'plus' as const,
    popoverItems: [
      { id: 'add-phase', icon: 'plus' as const, label: 'Фаза', onSelect: addPhase, disabled: busy || phaseCreateBusy },
      { id: 'add-day', icon: 'plus' as const, label: 'День', onSelect: addDay, disabled: busy || phaseCreateBusy || !details.phases.length },
    ],
  } : null, [details, readOnly, addPhase, addDay, busy, phaseCreateBusy]);
  useNavigationSurfaceFloatingAction(floatingAction);

  const activate = async (phaseId: string, previousPhaseStatus?: 'draft' | 'pending' | 'finished' | 'cancelled') => {
    if (!details) return;
    const other = (await repository.listReadable()).find((plan) =>
      isOtherActiveProgramInScope(plan, details.program));
    if (other) {
      setDialog({
        kind: 'select', title: 'Выберите статус для текущей активной программы',
        options: INACTIVE,
        onConfirm: async (value) => {
          await repository.activate(planId, phaseId, {
            previousPhaseStatus,
            previousProgramStatus: value as 'draft' | 'finished' | 'cancelled',
          });
          setDialog(null);
        },
      });
    } else {
      await repository.activate(planId, phaseId, { previousPhaseStatus });
      setDialog(null);
    }
  };
  const confirmActivation = async (phaseId: string, previousPhaseStatus?: 'draft' | 'pending' | 'finished' | 'cancelled') => {
    if (details?.program.status !== 'active') {
      setDialog({
        kind: 'confirm', title: 'Программа будет активирована.',
        onConfirm: async () => { await activate(phaseId, previousPhaseStatus); },
      });
    } else {
      await activate(phaseId, previousPhaseStatus);
    }
  };
  const requestActivation = async (phase: CloudProgramPhaseRow) => {
    const previous = details?.phases.find((item) => item.id !== phase.id && item.status === 'active');
    if (previous) {
      setDialog({
        kind: 'select', title: 'Выберите статус для текущей активной фазы',
        options: [...INACTIVE, { value: 'pending', label: 'В ожидании' }],
        onConfirm: async (value) =>
          confirmActivation(phase.id, value as 'draft' | 'pending' | 'finished' | 'cancelled'),
      });
    } else await confirmActivation(phase.id);
  };

  const action = (key: string, phase: CloudProgramPhaseRow) => {
    if (!details || busy) return;
    if (key === 'rename') {
      setDialog({
        kind: 'text', title: 'Переименовать фазу', initial: phase.name,
        onConfirm: async (value) => {
          await repository.renamePhase(planId, phase.id, value);
          setDialog(null);
        },
      });
    } else if (key === 'weeks') {
      setDialog({
        kind: 'weeks', title: 'Длительность фазы', initial: String(phase.durationWeeks ?? 10),
        onConfirm: async (value) => {
          await repository.duration(planId, phase.id, Number(value));
          setDialog(null);
        },
      });
    } else if (key === 'duplicate') {
      void run(() => repository.duplicatePhase(planId, phase.id));
    } else if (key === 'delete') {
      setDialog({
        kind: 'confirm', title: 'Удалить фазу?', destructive: true,
        description: 'Фаза и её дни будут удалены из программы. История тренировок сохранится.',
        confirmLabel: 'Удалить',
        onConfirm: async () => {
          await repository.deletePhase(planId, phase.id);
          setDialog(null);
        },
      });
    } else if (key === 'activate') {
      void run(() => requestActivation(phase));
    } else if (key === 'status') {
      setDialog({
        kind: 'select', title: 'Сменить статус фазы', options: PHASE_STATUSES,
        initial: phase.status,
        onConfirm: async (value) => {
          if (value === 'active') {
            await requestActivation(phase);
          } else if (coachGuidance && details.program.clientUserId !== null
            && value === 'draft' && phase.status !== 'draft'
            && details.program.status === 'active') {
            setDialog({
              kind: 'confirm', title: 'Скрыть фазу от клиента?',
              description: 'Фаза перестанет отображаться у клиента, пока остаётся черновиком.',
              onConfirm: async () => {
                await repository.setPhaseStatus(planId, phase.id, 'draft');
                setDialog(null);
              },
            });
          } else {
            await repository.setPhaseStatus(planId, phase.id,
              value as 'draft' | 'pending' | 'finished' | 'cancelled');
            setDialog(null);
          }
        },
      });
    }
  };

  const syncNotice = <PlanSyncNotice cloudStatus={cloudStatus} cloudError={cloudError}
    syncStatus={syncStatus} syncError={syncError}
    onRetryCloud={onRetryCloud} onRetrySync={onRetrySync}
    localError={error} onRetryLocal={() => setRetryKey((n) => n + 1)} />;

  if (loading) return <Text variant="footnote" tone="muted">Загружаем программу…</Text>;
  if (!details) return (
    <section className="cloud-plan-loading">
      {syncNotice}
      <Text variant="headline">{error || (syncStatus === 'synced' ? 'Программа не найдена' : 'Программа ещё не загружена на устройство')}</Text>
      <Button onClick={() => setRetryKey((n) => n + 1)}>Повторить</Button>
    </section>
  );
  return (
    <section className="cloud-plan-details" aria-label={`Программа ${details.program.name}`}>
      {syncNotice}
      <div className="cloud-plan-title-row">
        <div className="cloud-plan-main-title"><Text variant="large-title">{details.program.name}</Text></div>
        <Badge color={details.program.status === 'active' ? 'green' : 'gray'}>
          {details.program.status === 'active' ? 'Активная' :
            details.program.status === 'draft' ? 'Черновик' :
              details.program.status === 'finished' ? 'Завершена' : 'Отменена'}
        </Badge>
      </div>
      <ProgramSummary program={details.program} phaseCount={details.phases.length}
        actorUserId={repository.actorUserId} actor={actor} />
      {coachGuidance && details.program.clientUserId !== null ? (
        <Text variant="footnote" tone="muted" className="cloud-plan-visibility-tip">
          Клиент видит опубликованные программы и их фазы, кроме черновиков.
          Чтобы подготовленная фаза появилась у клиента, завершите её заполнение.
        </Text>
      ) : null}
      <Text variant="title">Фазы</Text>
      {details.phases.length ? details.phases.map((phase) => (
        <PhaseHeading key={phase.id} phase={phase} disabled={busy} readOnly={readOnly}
          onAction={action}
          onPublish={(item) => setDialog({
            kind: 'confirm', title: 'Завершить заполнение фазы?',
            description: coachGuidance && details.program.clientUserId !== null
              ? 'Фаза перейдёт в статус «В ожидании». Клиент увидит её, если программа не является черновиком. Редактирование останется доступным.'
              : 'Фаза перейдёт в статус «В ожидании». Редактирование останется доступным.',
            onConfirm: async () => {
              await repository.publishPhase(planId, item.id);
              setDialog(null);
            },
          })}
        >
          {(collapsed, bodyId) => <ProgramPhaseDays key={`${planId}:${phase.id}`} repository={repository} program={details.program}
            days={(details.days ?? []).filter((item) => item.day.programPhaseId === phase.id)}
            collapsed={collapsed} bodyId={bodyId} viewerRole={viewerRole} onNavigationContextChange={onNavigationContextChange} readOnly={readOnly} actor={actor} /> }
        </PhaseHeading>
      )) : <Text variant="footnote" tone="muted">{readOnly ? 'В программе пока нет подготовленных фаз.' : 'Добавьте первую фазу через кнопку «Добавить».'}</Text>}
      <MezfitDialog
        opened={phaseCreateOpen}
        title="Добавить фазу"
        onBackdropClick={!phaseCreateBusy ? () => setPhaseCreateOpen(false) : undefined}
        role="dialog" aria-modal="true" aria-label="Добавить фазу"
        buttons={(
          <>
            <MezfitDialogButton disabled={phaseCreateBusy}
              onClick={() => setPhaseCreateOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong disabled={phaseCreateBusy || busy}
              onClick={() => { void savePhase(); }}>
              {phaseCreateBusy ? 'Сохранение…' : 'Сохранить'}
            </MezfitDialogButton>
          </>
        )}
      >
        <KonstaList nested>
          <ListInput floatingLabel inputId="cloud-phase-name"
            label={<label htmlFor="cloud-phase-name">Название</label>}
            value={phaseName} maxLength={120} disabled={phaseCreateBusy}
            error={phaseNameRequired ? 'Обязательно к заполнению' : undefined}
            onChange={(event) => {
              setPhaseName(event.target.value);
              setPhaseNameRequired(false);
              setPhaseCreateError('');
            }} />
        </KonstaList>
        {phaseCreateError ? <Text variant="footnote" role="alert">{phaseCreateError}</Text> : null}
      </MezfitDialog>
      {dayCreatePhaseId && !readOnly ? <ProgramDayDialog key={`${planId}:${dayCreatePhaseId}`}
        title="Добавить день" onClose={() => setDayCreatePhaseId(null)}
        onSave={async (value) => { await repository.createDay(planId, dayCreatePhaseId, value.name, value.category); }} /> : null}
      <PlanActionDialog dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
