import { forwardRef, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import type { WorkoutScheduleFormat } from '../data/cloud/workout-scheduling-types';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { Avatar, GlassSurface, Icon, IconButton, LiquidPopover, SortableList, Text, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import { StartWorkoutButton } from './StartWorkoutButton';
import { SessionExercise } from './SessionExercise';
import { SpotlightTarget } from '../ui/SpotlightHint';
import './workout-session-card.css';

export interface WorkoutPlanCardProps {
  mode: 'planning';
  collapsed?: boolean;
  onCollapsedChange?: () => void;
  scheduledTiming?: { date: string; time: string };
  hideHeader?: boolean;
  /** Numeric assignments belong only to a scheduled occurrence. */
  showPlanMetrics?: boolean;
  programName?: string;
  hideProgramName?: boolean;
  canScheduleCoached?: boolean;
  onSchedule?: (format: WorkoutScheduleFormat) => void;
  /** Ad-hoc source picking starts immediately, without creating calendar PLAN. */
  onStart?: () => void;
  /** Source-selection mode: keep controls visible, explain instead of mutating. */
  onMutationAttempt?: () => void;
  hideProgramMenu?: boolean;
  hideWorkoutActions?: boolean;
  onReorderExercises?: (ids: string[]) => void;
  /** Use the viewport as the drag-overlay coordinate space inside animated sheets. */
  portalDragOverlay?: boolean;
  /** Keep the scrollable sheet at its current offset while exercise cards collapse. */
  preserveDragHeight?: boolean;
  day: CloudProgramDayOutline;
  creatorName: string;
  creatorAvatar?: ReactNode;
  readOnly?: boolean;
  busy?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onAddExercise?: () => void;
  onAddSet?: (programExerciseId: string) => void;
  onDeleteExercise?: (programExerciseId: string) => void;
  onOpenSet?: (programExerciseId: string, setId: string) => void;
  onDeleteSet?: (programExerciseId: string, setId: string) => void;
  onExerciseInformation?: (programExerciseId: string) => void;
  onEdit: () => void;
  onComment: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export interface WorkoutPlanCardHeaderProps {
  name: string;
  programName?: string;
  hideProgramName?: boolean;
  creatorName: string;
  creatorAvatar?: ReactNode;
  scheduledTiming?: { date: string; time: string };
  collapsed?: boolean;
  onCollapsedChange?: () => void;
  children?: ReactNode;
}

/** Shared program/scheduled day identity, timing and owner header. */
export function WorkoutPlanCardHeader({ name, programName = 'Без программы', hideProgramName = false,
  creatorName, creatorAvatar, scheduledTiming, collapsed = false, onCollapsedChange, children,
}: WorkoutPlanCardHeaderProps) {
  return <div className={`workout-session-card__header${scheduledTiming ? ' workout-session-card__header--scheduled' : ''}`}>
    <span className="workout-session-card__icon">
      <Icon name="barbell" className="workout-session-card__icon-artwork" />
    </span>
    <div className="workout-session-card__copy">
      <Text variant="body" className="workout-session-card__workout-name">{name}</Text>
      {!hideProgramName ? <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
        {programName}
      </Text> : null}
    </div>
    {scheduledTiming ? <div className="workout-session-card__time">
      <Text variant="footnote">{scheduledTiming.date}</Text>
      <Text variant="footnote" tone="muted">{scheduledTiming.time}</Text>
    </div> : null}
    {onCollapsedChange ? <IconButton
      label={collapsed ? 'Развернуть тренировку' : 'Свернуть тренировку'}
      aria-expanded={!collapsed} onClick={onCollapsedChange}>
      <span className={`workout-plan-card__chevron${collapsed ? '' : ' workout-plan-card__chevron--expanded'}`}>
        <Icon name="chevron-right" />
      </span>
    </IconButton> : children ?? <span className="workout-session-card__menu-placeholder" aria-hidden="true" />}
    <div className="workout-plan-card__avatar" aria-label={`Автор: ${creatorName}`}>
      {creatorAvatar ?? <Avatar name={creatorName} />}
    </div>
  </div>;
}

const PlanGlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ 'aria-disabled': disabled, ...props }, ref) =>
    <button type="button" ref={ref} disabled={disabled === true || disabled === 'true'} {...props} />,
);
PlanGlassButton.displayName = 'PlanGlassButton';

/** Program template mode deliberately has neither a session nor numeric PLAN/FACT.
 * The future set editor plugs into this domain instead of the legacy numeric API. */
export function WorkoutPlanCard({
  collapsed = false, onCollapsedChange, scheduledTiming, hideHeader = false,
  day: outline, programName = 'Без программы', canScheduleCoached = false, onSchedule, onStart,
  hideProgramMenu = false, hideWorkoutActions = false, hideProgramName = false,
  onReorderExercises, portalDragOverlay = false, preserveDragHeight = false,
  creatorName, creatorAvatar, readOnly = false, busy = false,
  canMoveUp = false, canMoveDown = false, onEdit, onComment, onMove, onDuplicate, onDelete, onAddExercise, onAddSet,
  onDeleteExercise, onExerciseInformation, onOpenSet, onDeleteSet, onMutationAttempt, showPlanMetrics = false,
}: WorkoutPlanCardProps) {
  const { day, exercises } = outline;
  const authoringVisible = !readOnly;
  const mutate = (action?: () => void) => { if (readOnly) return; if (onMutationAttempt) onMutationAttempt(); else action?.(); };
  const [menuOpen, setMenuOpen] = useState(false);
  const [schedulePopoverOpen, setSchedulePopoverOpen] = useState(false);
  const [expandedExercises, setExpandedExercises] = useState<ReadonlySet<string>>(() => new Set());
  const scheduleTriggerRef = useRef<HTMLElement>(null);
  const [afterMenu, setAfterMenu] = useState<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  const defer = (action: () => void) => {
    setAfterMenu(() => action);
    setMenuOpen(false);
  };
  const menu: LiquidPopoverItem[] = !authoringVisible || hideProgramMenu ? [] : [
    { id: 'edit', label: 'Переименовать', icon: 'pencil', disabled: busy, onSelect: () => defer(() => mutate(onEdit)) },
    { id: 'up', label: 'Вверх', icon: 'arrow-up', disabled: busy || (!onMutationAttempt && !canMoveUp), onSelect: () => defer(() => mutate(() => onMove('up'))) },
    { id: 'down', label: 'Вниз', icon: 'arrow-down', disabled: busy || (!onMutationAttempt && !canMoveDown), onSelect: () => defer(() => mutate(() => onMove('down'))) },
    { id: 'duplicate', label: 'Дублировать', icon: 'copy-outline', disabled: busy, onSelect: () => defer(() => mutate(onDuplicate)) },
    { id: 'comment', label: 'Комментарий', icon: 'message-circle', disabled: busy, onSelect: () => defer(() => mutate(onComment)) },
    ...(!onMutationAttempt ? [{ id: 'start', label: 'Начать тренировку', icon: 'treadmill' as const, disabled: true, dividerBefore: true }] : []),
    ...(!onStart ? [{ id: 'schedule', label: 'Запланировать', icon: 'calendar-plus' as const, disabled: busy || !onSchedule,
      onSelect: () => defer(() => canScheduleCoached
        ? setSchedulePopoverOpen(true) : onSchedule?.('independent')) }] : []),
    { id: 'delete', label: 'Удалить', icon: 'trash-outline', disabled: busy, dividerBefore: true, onSelect: () => defer(() => mutate(onDelete)) },
  ];
  const items = collapsed ? [] : exercises.map((item) => ({
    id: item.exercise.id,
    content: <SessionExercise mode="program" data={item} surface="transparent" editable={authoringVisible}
      showPlanMetrics={showPlanMetrics}
      collapsed={!expandedExercises.has(item.exercise.id)}
      onCollapsedChange={(collapsed) => setExpandedExercises((current) => {
        const next = new Set(current);
        if (collapsed) next.delete(item.exercise.id);
        else next.add(item.exercise.id);
        return next;
      })}
      busy={busy} onAddSet={authoringVisible && (onMutationAttempt || onAddSet) ? () => mutate(() => onAddSet?.(item.exercise.id)) : undefined}
      onOpenSet={onOpenSet || (authoringVisible && onMutationAttempt) ? setId => {
        if (onMutationAttempt && authoringVisible) onMutationAttempt();
        else onOpenSet?.(item.exercise.id, setId);
      } : undefined}
      onDeleteSet={authoringVisible && (onMutationAttempt || onDeleteSet) ? setId => mutate(() => onDeleteSet?.(item.exercise.id, setId)) : undefined}
      onDelete={authoringVisible && (onMutationAttempt || onDeleteExercise) ? () => mutate(() => onDeleteExercise?.(item.exercise.id)) : undefined}
      onInformation={onExerciseInformation ? () => onExerciseInformation(item.exercise.id) : undefined} />,
  }));
  return <article aria-label={`День ${day.name}`}>
    <SortableList items={items} disabled={Boolean(onMutationAttempt) || readOnly || busy || !onReorderExercises} showSeparators={false}
      lockToVerticalAxis syncDropLayout portalOverlay={portalDragOverlay} preserveListHeightOnDrag={preserveDragHeight}
      onDragStart={() => setExpandedExercises(new Set())}
      onReorder={(rows) => mutate(() => onReorderExercises?.(rows.map((row) => String(row.id))))}
      header={hideHeader ? undefined : <WorkoutPlanCardHeader name={day.name} programName={programName}
        hideProgramName={hideProgramName} creatorName={creatorName} creatorAvatar={creatorAvatar}
        scheduledTiming={scheduledTiming} collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
        {menu.length ? <LiquidPopover isOpen={menuOpen} onOpenChange={setMenuOpen}
          triggerRef={triggerRef} label={`Меню дня ${day.name}`} items={menu}
          preset={glass.preset} optics={glass.optics}
          onPresentationChange={(presented) => {
            if (presented || !afterMenu) return;
            const action = afterMenu;
            setAfterMenu(null);
            action();
          }}
          trigger={<IconButton ref={triggerRef} icon="dots-vertical" label={`Меню дня ${day.name}`} />} />
          : <span className="workout-session-card__menu-placeholder" aria-hidden="true" />}
      </WorkoutPlanCardHeader>}
      footer={collapsed ? undefined : <div className="workout-session-card__footer">
        {!exercises.length ? <Text variant="footnote" tone="muted">В этом дне пока нет упражнений</Text> : null}
        {authoringVisible ? <GlassSurface component={PlanGlassButton} wrapContent={false} shape="capsule" preset="modalTuned"
          className="workout-session-card__add-exercise" aria-disabled={busy || (!onMutationAttempt && !onAddExercise)}
          onClick={() => { if (!busy) mutate(onAddExercise); }}>
          <span className="workout-session-card__add-exercise-icon"><Icon name="plus" /></span>
          <Text variant="body">Добавить упражнение</Text>
        </GlassSurface> : null}
        {day.comment ? <Text variant="body" className="workout-plan-card__comment">{day.comment}</Text> : null}

        {!hideWorkoutActions && (authoringVisible || onSchedule || onStart) ? <div className={`workout-plan-card__actions${onStart && !onSchedule ? ' workout-plan-card__actions--start' : ''}`}>
          {onStart ? <StartWorkoutButton disabled={busy} onClick={onStart} /> : null}
          {onSchedule ? <SpotlightTarget>{canScheduleCoached ? (
            <LiquidPopover isOpen={schedulePopoverOpen} onOpenChange={setSchedulePopoverOpen}
              triggerRef={scheduleTriggerRef} label="Формат тренировки"
              preset={glass.preset} optics={glass.optics}
              items={[
                { id: 'coached', label: 'В зале с клиентом', icon: 'users',
                  onSelect: () => onSchedule('coached') },
                { id: 'independent', label: 'Самостоятельная', icon: 'user',
                  onSelect: () => onSchedule('independent') },
              ]}
              trigger={<GlassSurface component={PlanGlassButton} ref={scheduleTriggerRef}
                wrapContent={false} shape="capsule" preset="modalTuned"
                glass={{ tintR: 244, tintG: 218, tintB: 139, tintA: 0.14 }}
                aria-disabled={busy} className="workout-plan-card__action">
                <Icon name="calendar-plus" className="workout-plan-card__action-icon" />
                <Text variant="body" className="workout-plan-card__action-label">Запланировать</Text>
              </GlassSurface>} />
          ) : (
            <GlassSurface component={PlanGlassButton} wrapContent={false} shape="capsule" preset="modalTuned"
              glass={{ tintR: 244, tintG: 218, tintB: 139, tintA: 0.14 }}
              aria-disabled={busy} onClick={() => { if (!busy) onSchedule('independent'); }}
              className="workout-plan-card__action">
              <Icon name="calendar-plus" className="workout-plan-card__action-icon" />
              <Text variant="body" className="workout-plan-card__action-label">Запланировать</Text>
            </GlassSurface>
          )}</SpotlightTarget> : null}
          {!onStart && !readOnly && !onMutationAttempt ? <StartWorkoutButton disabled label="Начать" /> : null}
        </div> : null}
      </div>} />
  </article>;
}
