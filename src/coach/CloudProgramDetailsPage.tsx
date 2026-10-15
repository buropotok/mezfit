import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudProgramPhaseRow } from '../data/cloud/workout-foundation-types';
import { athleteOf, type ProgramDetails, type ProgramManagementRepository } from '../data/cloud/program-management';
import { useNavigationSurfaceFloatingAction } from '../NavigationShell';
import { Badge, Button, GlassSurface, IconButton, LiquidPopover, Text, type BadgeColor, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
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
        <Text variant="footnote" className="cloud-plan-phase-weeks">{weeks} недель</Text>
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
  repository, planId,
}: { repository: ProgramManagementRepository; planId: string }) {
  const [details, setDetails] = useState<ProgramDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PlanDialogState | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
      setError(reason instanceof Error ? reason.message : 'Изменение не сохранено');
    } finally { setBusy(false); }
  }, [busy]);

  const addPhase = useCallback(() => { void run(() => repository.createPhase(planId)); },
    [run, repository, planId]);
  const floatingAction = useMemo(() => details ? {
    label: 'Добавить',
    icon: 'plus' as const,
    popoverItems: [
      { id: 'add-phase', icon: 'plus' as const, label: 'Фаза', onSelect: addPhase, disabled: busy },
      { id: 'add-day', icon: 'plus' as const, label: 'День', disabled: true },
    ],
  } : null, [details, addPhase, busy]);
  useNavigationSurfaceFloatingAction(floatingAction);

  const activate = async (phaseId: string, previousPhaseStatus?: 'draft' | 'finished' | 'cancelled') => {
    if (!details) return;
    const other = (await repository.listReadable()).find((plan) => plan.id !== planId
      && plan.realmId === details.program.realmId
      && plan.status === 'active' && athleteOf(plan) === athleteOf(details.program));
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
  const confirmActivation = (phaseId: string, previousPhaseStatus?: 'draft' | 'finished' | 'cancelled') => {
    if (details?.program.status !== 'active') {
      setDialog({
        kind: 'confirm', title: 'Программа будет активирована.',
        onConfirm: async () => { await activate(phaseId, previousPhaseStatus); },
      });
    } else {
      void activate(phaseId, previousPhaseStatus).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Не удалось активировать фазу'));
    }
  };
  const requestActivation = (phase: CloudProgramPhaseRow) => {
    const previous = details?.phases.find((item) => item.id !== phase.id && item.status === 'active');
    if (previous) {
      setDialog({
        kind: 'select', title: 'Выберите статус для текущей активной фазы',
        options: INACTIVE,
        onConfirm: async (value) =>
          confirmActivation(phase.id, value as 'draft' | 'finished' | 'cancelled'),
      });
    } else confirmActivation(phase.id);
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
        description: 'Фаза и все её запланированные дни и подходы будут удалены.',
        confirmLabel: 'Удалить',
        onConfirm: async () => {
          await repository.deletePhase(planId, phase.id);
          setDialog(null);
        },
      });
    } else if (key === 'activate') {
      requestActivation(phase);
    } else if (key === 'status') {
      setDialog({
        kind: 'select', title: 'Сменить статус фазы', options: PHASE_STATUSES,
        initial: phase.status,
        onConfirm: async (value) => {
          if (value === 'active') {
            requestActivation(phase);
          } else if (value === 'draft' && phase.status !== 'draft'
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

  if (loading) return <Text variant="footnote" tone="muted">Загружаем программу…</Text>;
  if (!details) return (
    <section className="cloud-plan-loading">
      <Text variant="headline">{error || 'Программа не найдена'}</Text>
      <Button onClick={() => setRetryKey((n) => n + 1)}>Повторить</Button>
    </section>
  );
  return (
    <section className="cloud-plan-details" aria-label={`Программа ${details.program.name}`}>
      <div className="cloud-plan-title-row">
        <div className="cloud-plan-main-title"><Text variant="large-title">{details.program.name}</Text></div>
        <Badge color={details.program.status === 'active' ? 'green' : 'gray'}>
          {details.program.status === 'active' ? 'Активная' :
            details.program.status === 'draft' ? 'Черновик' :
              details.program.status === 'finished' ? 'Завершена' : 'Отменена'}
        </Badge>
      </div>
      <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-summary">
        <div className="cloud-plan-summary-content">
          <Text variant="headline">Программа тренировок</Text>
          <Text variant="footnote" tone="muted">Атлет: {athleteOf(details.program) ?? 'Не указан'}</Text>
          <Text variant="body">Фаз: {details.phases.length}</Text>
        </div>
      </GlassSurface>
      <Text variant="footnote" tone="muted" className="cloud-plan-visibility-tip">
        Клиент видит только активную программу и её фазы, кроме черновиков.
        Чтобы подготовленная фаза появилась у клиента, завершите её заполнение.
      </Text>
      <Text variant="title">Фазы</Text>
      {details.phases.length ? details.phases.map((phase) => (
        <PhaseHeading key={phase.id} phase={phase} disabled={busy}
          onAction={action}
          onPublish={(item) => setDialog({
            kind: 'confirm', title: 'Завершить заполнение фазы?',
            description: 'Фаза перейдёт в статус «В ожидании». Клиент увидит её в активной программе. Редактирование останется доступным.',
            onConfirm: async () => {
              await repository.publishPhase(planId, item.id);
              setDialog(null);
            },
          })}
        />
      )) : <Text variant="footnote" tone="muted">Добавьте первую фазу через кнопку «Добавить».</Text>}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      <PlanActionDialog dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
