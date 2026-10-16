import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List as KonstaList, ListInput } from 'konsta/react';
import type { CloudProgramPhaseRow } from '../data/cloud/workout-foundation-types';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { isOtherActiveProgramInScope, type ProgramDetails, type ProgramManagementRepository } from '../data/cloud/program-management';
import { useNavigationSurfaceFloatingAction } from '../NavigationShell';
import { Badge, Button, IconButton, LiquidPopover, MezfitDialog, MezfitDialogButton, Text, type BadgeColor, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import { ProgramSummary, type ProgramActor } from './ProgramSummary';
import { programMutationMessage, weekLabel } from './programPresentation';
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
  phase, disabled, onAction, onPublish,
}: {
  phase: CloudProgramPhaseRow;
  disabled: boolean;
  onAction: (action: string, phase: CloudProgramPhaseRow) => void;
  onPublish: (phase: CloudProgramPhaseRow) => void;
}) {
  const [open, setOpen] = useState(false);
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
        <div className="cloud-plan-phase-title"><Text variant="title">{phase.name}</Text></div>
        <Badge color={label.color}>{label.label}</Badge>
        <Text variant="footnote" className="cloud-plan-phase-weeks">{weeks} {weekLabel(weeks)}</Text>
        <LiquidPopover
          isOpen={open}
          onOpenChange={setOpen}
          triggerRef={triggerRef}
          trigger={<IconButton ref={triggerRef} icon="dots-vertical"
            label={`Действия с фазой ${phase.name}`} />}
          items={menu}
          label={`Действия с фазой ${phase.name}`}
          preset={glass.preset}
          optics={glass.optics}
        />
      </div>
      <Text variant="footnote" tone="muted">Дни и упражнения появятся в следующей итерации.</Text>
      {phase.status === 'draft' ? (
        <Button variant="secondary" disabled={disabled} onClick={() => onPublish(phase)}>
          Завершить заполнение фазы
        </Button>
      ) : null}
    </section>
  );
}

export function CloudProgramDetailsPage({
  repository, planId, viewerRole = 'coach', actor, cloudStatus, cloudError, syncStatus, syncError, onRetryCloud, onRetrySync,
}: {
  repository: ProgramManagementRepository;
  planId: string;
  viewerRole?: 'coach' | 'client';
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
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetails(null);
    setDialog(null);
    setPhaseCreateOpen(false);
    setError('');
    const subscription = repository.observeDetails(planId, (value) => {
      if (!active) return;
      setDetails(value);
      setLoading(false);
    }, (reason) => {
      if (!active) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть программу');
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, planId, retryKey]);

  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await task(); }
    catch (reason) {
      setError(programMutationMessage(reason));
    } finally { setBusy(false); }
  }, [busy]);

  const addPhase = useCallback(() => {
    setPhaseName('');
    setPhaseNameRequired(false);
    setPhaseCreateError('');
    setPhaseCreateOpen(true);
  }, []);
  const savePhase = async () => {
    if (busy || phaseCreateBusy) return;
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
      setError(message);
    } finally {
      setPhaseCreateBusy(false);
    }
  };
  const floatingAction = useMemo(() => details && coachGuidance ? {
    label: 'Добавить',
    icon: 'plus' as const,
    popoverItems: [
      { id: 'add-phase', icon: 'plus' as const, label: 'Фаза', onSelect: addPhase, disabled: busy || phaseCreateBusy },
      { id: 'add-day', icon: 'plus' as const, label: 'День', disabled: true },
    ],
  } : null, [details, coachGuidance, addPhase, busy, phaseCreateBusy]);
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
        description: 'Будет удалена только фаза без дней. Фазу с днями удалить пока нельзя.',
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
          Клиент видит только активную программу и её фазы, кроме черновиков.
          Чтобы подготовленная фаза появилась у клиента, завершите её заполнение.
        </Text>
      ) : null}
      <Text variant="title">Фазы</Text>
      {details.phases.length ? details.phases.map((phase) => (
        <PhaseHeading key={phase.id} phase={phase} disabled={busy}
          onAction={action}
          onPublish={(item) => setDialog({
            kind: 'confirm', title: 'Завершить заполнение фазы?',
            description: coachGuidance && details.program.clientUserId !== null
              ? 'Фаза перейдёт в статус «В ожидании». Клиент увидит её в активной программе. Редактирование останется доступным.'
              : 'Фаза перейдёт в статус «В ожидании». Редактирование останется доступным.',
            onConfirm: async () => {
              await repository.publishPhase(planId, item.id);
              setDialog(null);
            },
          })}
        />
      )) : <Text variant="footnote" tone="muted">Добавьте первую фазу через кнопку «Добавить».</Text>}
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
      <PlanActionDialog dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
