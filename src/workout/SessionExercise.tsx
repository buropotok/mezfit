import { ExecutionSetDiscussionMenu } from '../discussions/ExecutionSetDiscussionMenu';
import { DiscussionSetFocus } from './DiscussionSetFocus';
import type { EntityDiscussionTarget } from '../discussions/entity-discussion-target';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SET_TYPE_LABELS } from '../../shared/set-type';
import type { ExerciseCategoryCode, ExerciseEquipmentCode, TrackingType } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Badge, CompactActionGroup, GlassSurface, Icon, IconButton, List, ListItem, Text } from '../ui';
import { SetEntry } from './SetEntry';
import { ExerciseActionsMenu } from './ExerciseActionsMenu';
import type { SetEntryProgramIdentity, SetMetrics } from './setEntryTypes';
import type { ProgramSessionExerciseProps, SessionExerciseProps, SessionExerciseData, SessionExerciseSetData, WorkoutSessionExerciseProps } from './sessionExerciseTypes';
import './session-exercise.css';

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const distanceFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const categoryLabels: Record<ExerciseCategoryCode, string> = {
  chest: 'Грудь',
  arms: 'Руки',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  core: 'Корпус',
  full_body: 'Фулбоди',
  cardio: 'Кардио',
  other: 'Другое',
};

const equipmentLabels: Record<ExerciseEquipmentCode, string> = {
  bodyweight: 'Свой вес',
  barbell: 'Штанга',
  dumbbell_single: 'Гантель x1',
  dumbbell_pair: 'Гантели x2',
  cable: 'Трос',
  machine: 'Тренажер',
  other: 'Другое',
};

function SharedIcon({ name }: { name: 'check' | 'chevron-down' | 'chevron-right' }) {
  return <span className={`session-exercise__icon session-exercise__icon--${name}`} aria-hidden="true" />;
}

function formatSetCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} подходов`;
  if (mod10 === 1) return `${count} подход`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} подхода`;
  return `${count} подходов`;
}

function formatDuration(value: number | null): string | null {
  if (value === null) return null;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatWeight(value: number | null): string | null {
  return value === null ? null : `${numberFormatter.format(value)} кг`;
}

function formatReps(value: number | null): string | null {
  return value === null ? null : `${numberFormatter.format(value)} повт.`;
}

function formatDistance(value: number | null): string | null {
  return value === null ? null : `${distanceFormatter.format(value / 1000)} км`;
}

function joinMetrics(parts: Array<string | null>, separator = ' · '): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(separator) : null;
}

export function formatSessionSetMetrics(metrics: SetMetrics | null, trackingType: TrackingType): string | null {
  if (!metrics) return null;
  const weight = formatWeight(metrics.weightKg);
  const reps = formatReps(metrics.reps);
  const duration = formatDuration(metrics.durationSeconds);
  const distance = formatDistance(metrics.distanceMeters);

  switch (trackingType) {
    case 'weight_reps':
      return weight && reps ? `${weight} × ${numberFormatter.format(metrics.reps ?? 0)}` : weight ?? reps;
    case 'time':
      return duration;
    case 'time_distance':
      return joinMetrics([duration, distance]);
    case 'time_reps':
      return joinMetrics([duration, reps]);
    case 'time_weight':
      return joinMetrics([duration, weight]);
  }
}

function exerciseMeta<Id extends string | number>(data: SessionExerciseData<Id>): string {
  const parts: string[] = [];
  if (data.exercise.category_code) parts.push(categoryLabels[data.exercise.category_code]);
  if (data.exercise.equipment_code) parts.push(equipmentLabels[data.exercise.equipment_code]);
  parts.push(formatSetCount(data.sets.length));
  return parts.join(' · ');
}

function SetStatus<Id extends string | number>({ set }: { set: SessionExerciseSetData<Id> }) {
  if (set.status === 'completed') {
    return <span className="session-exercise__set-status session-exercise__set-status--completed"><SharedIcon name="check" /></span>;
  }
  return <span className="session-exercise__set-status"><Text variant="footnote">{set.position + 1}</Text></span>;
}

function planSetSubtitle<Id extends string | number>(set: SessionExerciseSetData<Id>): ReactNode | undefined {
  return set.setType ? <Text variant="caption" tone="muted">Тип подхода: {SET_TYPE_LABELS[set.setType]}</Text> : undefined;
}

/** PLAN is a two-line left column; FACT owns the right column and wins on overflow. */
function WorkoutSetSummary({ plan, fact }: { plan: string | null; fact: string | null }) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const factRef = useRef<HTMLSpanElement>(null);
  const planRef = useRef<HTMLSpanElement>(null);
  const planWidthRef = useRef(0);
  const [showPlan, setShowPlan] = useState(true);
  useLayoutEffect(() => {
    if (!fact || !plan) return;
    const update = () => {
      const content = contentRef.current;
      const node = factRef.current;
      if (!content || !node) return;

      const available = content.getBoundingClientRect().width;
      if (planRef.current) planWidthRef.current = planRef.current.getBoundingClientRect().width;

      // Measure the complete FACT independently of the PLAN width, so hiding PLAN
      // cannot cause a show/hide loop when the FACT becomes a single line.
      const previousPosition = node.style.position;
      const previousWidth = node.style.width;
      const previousWhiteSpace = node.style.whiteSpace;
      const previousFlex = node.style.flex;
      node.style.position = 'absolute';
      node.style.width = 'max-content';
      node.style.whiteSpace = 'nowrap';
      node.style.flex = 'none';
      const factWidth = node.getBoundingClientRect().width;
      node.style.position = previousPosition;
      node.style.width = previousWidth;
      node.style.whiteSpace = previousWhiteSpace;
      node.style.flex = previousFlex;

      const gap = Number.parseFloat(window.getComputedStyle(content).columnGap) || 0;
      if (available > 0 && factWidth > 0 && planWidthRef.current > 0) {
        setShowPlan(available + 0.5 >= planWidthRef.current + gap + factWidth);
        return;
      }

      // DOM-less test environments have no measured widths; preserve the
      // wrapping fallback without re-showing PLAN after its removal.
      if (!planRef.current) return;
      const style = window.getComputedStyle(node.firstElementChild ?? node);
      const fontSize = Number.parseFloat(style.fontSize);
      const resolvedLineHeight = Number.parseFloat(style.lineHeight);
      const lineHeight = Number.isFinite(resolvedLineHeight) && resolvedLineHeight > 3
        ? resolvedLineHeight : fontSize * (Number.isFinite(resolvedLineHeight) ? resolvedLineHeight : 1.4);
      if (lineHeight > 0 && node.getBoundingClientRect().height > lineHeight * 1.6) setShowPlan(false);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [fact, plan, showPlan]);
  return <span ref={contentRef} className="session-exercise__set-summary">
    {plan && (!fact || showPlan) ? <span ref={planRef} className="session-exercise__set-plan-block">
      <Text variant="caption" className="session-exercise__set-plan-heading">План:</Text>
      <Text variant="body" className="session-exercise__set-plan-value">{plan}</Text>
    </span> : null}
    {fact ? <span ref={factRef} className="session-exercise__set-fact">
      <Text variant="headline">{fact}</Text>
    </span> : <Text variant="body" className="session-exercise__set-fact--empty">Ввести факт</Text>}
  </span>;
}

interface SessionExerciseLayoutProps {
  exerciseId: string | number;
  exerciseName: string;
  media: ReactNode;
  subtitle: string;
  badge?: ReactNode;
  notes: string | null;
  surface?: 'default' | 'transparent';
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onInformation?: () => void;
  /** Highlight only the media/name header for an exercise discussion deep link. */
  focusHeader?: boolean;
  focusReady?: boolean;
  onOpenExerciseMenu?: () => void;
  actions?: ReactNode;
  onAddSet?: () => void;
  busy?: boolean;
  summary?: ReactNode;
  editor?: ReactNode;
  children: ReactNode;
}

/** One layout owns the media, disclosure, set list and glass add-set control in both modes. */
function SessionExerciseLayout({
  exerciseId, exerciseName, media, subtitle, badge, notes, surface = 'default',
  collapsed: controlledCollapsed, defaultCollapsed = true, onCollapsedChange,
  onInformation, focusHeader = false, focusReady = true, onOpenExerciseMenu, actions, onAddSet, busy = false, summary, editor, children,
}: SessionExerciseLayoutProps) {
  const bodyId = useId();
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const [hasExpanded, setHasExpanded] = useState(!collapsed);
  useEffect(() => {
    if (!collapsed) setHasExpanded(true);
  }, [collapsed]);
  // A collapsed card never mounts its set rows until first expanded; keep them mounted thereafter.
  const mountBody = hasExpanded || !collapsed;
  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    if (controlledCollapsed === undefined) setInternalCollapsed(nextCollapsed);
    onCollapsedChange?.(nextCollapsed);
  };
  const header = <ListItem
    className="session-exercise__header-toggle"
    leadingShape="square"
    leading={media}
    title={exerciseName}
    subtitle={subtitle}
    trailing={badge}
    trailingSpacing="compact"
    aria-expanded={!collapsed}
    aria-controls={bodyId}
    onClick={toggleCollapsed}
  />;
  return (
    <article className={`session-exercise${surface === 'default' ? ' session-exercise--surface' : ''}`} data-session-exercise-id={typeof exerciseId === 'number' ? exerciseId : undefined}
      data-program-exercise-id={typeof exerciseId === 'string' ? exerciseId : undefined}>
      <div className="session-exercise__header">
        <div className="session-exercise__header-list">
          <List>
            {focusHeader ? <DiscussionSetFocus ready={focusReady}>{header}</DiscussionSetFocus> : header}
          </List>
          {onInformation ? <button type="button" className="session-exercise__media-action"
            data-no-dnd aria-label={`Информация об упражнении: ${exerciseName}`}
            onClick={onInformation} /> : null}
        </div>
        <CompactActionGroup aria-label="Действия упражнения" data-no-dnd>
          <IconButton size="compact"
            className={`session-exercise__collapse${collapsed ? ' session-exercise__collapse--collapsed' : ''}`}
            data-no-dnd
            label={collapsed ? 'Развернуть упражнение' : 'Свернуть упражнение'}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
          >
            <SharedIcon name="chevron-down" />
          </IconButton>
          {actions ?? (onOpenExerciseMenu ? <IconButton size="compact" className="session-exercise__menu"
            data-no-dnd icon="dots-vertical" label="Опции упражнения" onClick={onOpenExerciseMenu} /> : null)}
        </CompactActionGroup>
      </div>

      <div id={bodyId} className="session-exercise__body" hidden={collapsed}>
        {mountBody ? <>
          {notes ? <Text variant="footnote" tone="muted" className="session-exercise__notes">{notes}</Text> : null}

          {children}
          {onAddSet ? (
            <div className="session-exercise__add-set">
              <button
                type="button"
                className="session-exercise__add-set-hit"
                data-no-dnd
                aria-label="Добавить подход"
                onClick={onAddSet}
                disabled={busy}
              >
                <GlassSurface
                  component="span"
                  wrapContent={false}
                  shape="capsule"
                  className="session-exercise__add-set-button"
                  aria-hidden="true"
                >
                  <Icon name="plus" variant="outline" className="session-exercise__add-set-icon" />
                </GlassSurface>
              </button>
              <Text variant="body" className="session-exercise__add-set-label">Добавить подход</Text>
            </div>
          ) : null}

          {summary}
        </> : null}
      </div>
      {editor}
    </article>
  );
}

function formatProgramPlanMetrics(set: ProgramSessionExerciseProps['data']['sets'][number]): string {
  const weightAndReps = set.plannedReps !== null && set.plannedWeightKg !== null
    ? `${numberFormatter.format(set.plannedWeightKg)} кг × ${numberFormatter.format(set.plannedReps)}`
    : joinMetrics([formatReps(set.plannedReps), formatWeight(set.plannedWeightKg)]);
  return joinMetrics([weightAndReps, formatDuration(set.plannedDurationSeconds),
    formatDistance(set.plannedDistanceMeters)]) ?? 'Не заполнено';
}

function ProgramExerciseSets({ sets, onOpenSet, onDeleteSet, discussionTargetForSet, onOpenDiscussion,
  onNavigationContextChange, onSetDeletionNavigationContextChange, showPlanMetrics = false,
  focusSetId, focusReady = true }: {
  showPlanMetrics?: boolean;
  focusSetId?: string;
  focusReady?: boolean;
  sets: ProgramSessionExerciseProps['data']['sets'];
  onOpenSet?: ProgramSessionExerciseProps['onOpenSet'];
  onDeleteSet?: ProgramSessionExerciseProps['onDeleteSet'];
  discussionTargetForSet?: (setId: string) => EntityDiscussionTarget | null;
  onOpenDiscussion?: ProgramSessionExerciseProps['onOpenDiscussion'];
  onNavigationContextChange?: ProgramSessionExerciseProps['onNavigationContextChange'];
  onSetDeletionNavigationContextChange?: ProgramSessionExerciseProps['onSetDeletionNavigationContextChange'];
}) {
  return (
    <List className="session-exercise__sets" divider="inset">
      {sets.map((set, index) => {
        const target = discussionTargetForSet?.(set.id) ?? null;
        const item = <ListItem key={set.id} className="session-exercise__set-row"
          onClick={onOpenSet ? () => onOpenSet?.(set.id) : undefined}
          trailing={!target && onDeleteSet ? <IconButton icon="trash-outline" label={`Удалить подход ${index + 1}`}
            onClick={(event) => { event.stopPropagation(); void onDeleteSet(set.id); }} /> : undefined}
          trailingActionSpacing="flush"
          trailingSpacing="compact"
          trailingAction={target ? <ExecutionSetDiscussionMenu target={target} setNumber={index + 1}
            onOpenTarget={onOpenDiscussion} onNavigationContextChange={onNavigationContextChange}
            onDeleteNavigationContextChange={onSetDeletionNavigationContextChange}
            onDeleteSet={onDeleteSet ? async () => { await onDeleteSet(set.id); } : undefined} /> : undefined}
          leading={<span className="session-exercise__set-status"><Text variant="footnote">{index + 1}</Text></span>}
          title={<Text variant="body" className={showPlanMetrics ? 'session-exercise__set-plan-line' : undefined}>
            {showPlanMetrics ? `План ${formatProgramPlanMetrics(set)}` : `Подход ${index + 1}`}
          </Text>}
          subtitle={<span className="session-exercise__set-recommendations">
            {set.setType ? <Text variant={showPlanMetrics ? 'caption' : 'footnote'}
              tone={showPlanMetrics ? 'muted' : undefined}>Тип подхода: {SET_TYPE_LABELS[set.setType]}</Text> : null}
            {set.comment ? <Text variant="footnote" tone="muted">{set.comment}</Text> : null}
            {set.materialLinks?.length ? <Text variant="caption" tone="muted">Материалы: {set.materialLinks.length}</Text> : null}
            {set.chatLinks?.length ? <Text variant="caption" tone="muted">Обсуждения: {set.chatLinks.length}</Text> : null}
          </span>}
        />;
        return set.id === focusSetId ? <DiscussionSetFocus key={set.id} ready={focusReady}>{item}</DiscussionSetFocus> : item;
      })}
    </List>
  );
}

function ProgramExercise(props: ProgramSessionExerciseProps) {
  const { exercise: item, sets } = props.data;
  const snapshot = item.exercise;
  return (
    <SessionExerciseLayout
      exerciseId={item.id} exerciseName={snapshot.name}
      media={<ExerciseMedia exercise={{ id: snapshot.exerciseDefinitionId, name: snapshot.name,
        reference_source: null, reference_key: null }} sourceUrl={snapshot.mediaUrl} variant="thumbnail" />}
      subtitle={formatSetCount(sets.length)} notes={item.notes}
      surface={props.surface} collapsed={props.collapsed} defaultCollapsed={props.defaultCollapsed}
      onCollapsedChange={props.onCollapsedChange} onInformation={props.busy ? undefined : props.onInformation}
      focusHeader={props.focusHeader} focusReady={props.focusReady}
      actions={<ExerciseActionsMenu busy={props.busy} discussionTarget={props.discussionTarget}
        onOpenDiscussion={props.onOpenDiscussion} onNavigationContextChange={props.onNavigationContextChange}
        onDelete={props.editable !== false ? props.onDelete : undefined} onInformation={props.onInformation} />}
      onAddSet={props.editable !== false ? props.onAddSet : undefined} busy={props.busy}
    >
      <ProgramExerciseSets sets={sets} onOpenSet={props.onOpenSet} onDeleteSet={props.onDeleteSet}
        discussionTargetForSet={props.discussionTargetForSet} onOpenDiscussion={props.onOpenDiscussion}
        onNavigationContextChange={props.onNavigationContextChange}
        onSetDeletionNavigationContextChange={props.onSetDeletionNavigationContextChange}
        showPlanMetrics={props.showPlanMetrics} focusSetId={props.focusSetId} focusReady={props.focusReady} />
    </SessionExerciseLayout>
  );
}

export function SessionExercise<Id extends string | number = number>(props: SessionExerciseProps<Id>) {
  if (props.mode === 'program') return <ProgramExercise {...props} />;
  if (props.mode === 'plan') return <WorkoutExercise<number> {...props} />;
  return <WorkoutExercise<Id> {...props} />;
}

// The public PLAN branch stays numeric. This private view shares its mechanics
// with FACT after the public dispatcher has narrowed each branch.
type WorkoutExerciseFactProps<Id extends string | number> = Extract<WorkoutSessionExerciseProps<Id>, { mode?: 'workout' }>;
type WorkoutExerciseViewProps<Id extends string | number> = WorkoutExerciseFactProps<Id> |
  (Omit<WorkoutExerciseFactProps<Id>, 'mode' | 'onSaveSet'> & {
    mode: 'plan';
    programExerciseId: number;
    createSet: SessionExerciseSetData<Id>;
    onPlanSetSaved: () => void;
  });

function WorkoutExerciseSets<Id extends string | number>({ exercise, onSelectSet }: {
  exercise: WorkoutExerciseViewProps<Id>;
  onSelectSet: (id: Id) => void;
}) {
  const data = exercise.data;
  const planMode = exercise.mode === 'plan';
  const editable = exercise.editable ?? true;
  const renderedSets = exercise.mode === 'plan' ? [...data.sets, exercise.createSet] : data.sets;
  return (
    <List className="session-exercise__sets" divider="inset">
      {renderedSets.map((set) => {
        const setNumber = set.position + 1;
        const metrics = formatSessionSetMetrics(
          planMode ? set.plan : set.fact?.metrics ?? null,
          exercise.data.exercise.tracking_type,
        );
        const plan = formatSessionSetMetrics(set.plan, exercise.data.exercise.tracking_type);
        const canOpenSet = !planMode || set.sourceProgramSetId === null;
        const discussionTarget = !planMode && exercise.discussionScope && set.discussionAnchor
          ? { scope: exercise.discussionScope, anchor: set.discussionAnchor,
            name: `${exerciseDisplayName(data.exercise)} · Подход ${setNumber}` } : null;
        const onDeleteSet = editable ? exercise.onDeleteSet : undefined;
        const deleteSet = !planMode && onDeleteSet ? () => onDeleteSet(set.sessionSetId) : undefined;
        const item = (
          <ListItem
            key={set.sessionSetId}
            className="session-exercise__set-row"
            trailingWidth={planMode ? 'content' : 'default'}
            trailingSpacing={planMode ? 'default' : 'compact'}
            trailingActionSpacing="flush"
            leading={<SetStatus set={set} />}
            title={planMode ? (
              <span className="session-exercise__set-title">
                <span>{`Подход ${setNumber}. План:`}</span>
                <span className={`session-exercise__set-fact${metrics ? '' : ' session-exercise__set-fact--empty'}`}>
                  {metrics ?? 'ввести план'}
                </span>
              </span>
            ) : <WorkoutSetSummary plan={plan} fact={metrics} />}
            subtitle={planMode ? planSetSubtitle(set) : undefined}
            trailing={planMode && canOpenSet ? <SharedIcon name="chevron-right" />
              : !planMode && set.fact?.rpe !== null && set.fact?.rpe !== undefined
                ? <span className="session-exercise__set-trailing"><Badge color="gray">RPE {set.fact.rpe}</Badge></span>
                : undefined}
            trailingAction={!planMode && (discussionTarget || deleteSet) ? <ExecutionSetDiscussionMenu
              target={discussionTarget}
              setNumber={setNumber} onNavigationContextChange={exercise.onNavigationContextChange}
              onDeleteNavigationContextChange={exercise.onSetDeletionNavigationContextChange}
              onOpenTarget={exercise.onOpenDiscussion} onDeleteSet={deleteSet} /> : undefined}
            aria-label={canOpenSet ? `Открыть подход ${setNumber}` : undefined}
            onClick={canOpenSet ? () => onSelectSet(set.sessionSetId) : undefined}
          />
        );
        return set.sessionSetId === exercise.focusSetId
          ? <DiscussionSetFocus key={String(set.sessionSetId)} ready={exercise.focusReady ?? true}>{item}</DiscussionSetFocus>
          : item;
      })}
    </List>
  );
}

function WorkoutExercise<Id extends string | number>(props: WorkoutExerciseViewProps<Id>) {
  const {
    context,
    discussionScope,
    onOpenDiscussion,
    data,
    collapsed: controlledCollapsed,
    defaultCollapsed = true,
    surface = 'default',
    editable = true,
    onAddSet,
    onDeleteSet,
    onCollapsedChange,
    onOpenExerciseMenu,
    onDeleteExercise,
    onInformation,
    onOpenHistory,
    onOpenChat,
    onNavigationContextChange,
  } = props;
  const [selectedSessionSetId, setSelectedSessionSetId] = useState<Id | null>(null);
  const completedSets = data.sets.filter((set) => set.status === 'completed').length;
  const totalSets = data.sets.length;
  const progress = totalSets === 0 ? 0 : Math.round((completedSets / totalSets) * 100);
  const exerciseName = exerciseDisplayName(data.exercise);
  const selectedSet = selectedSessionSetId === null
    ? null
    : (props.mode === 'plan' ? [...data.sets, props.createSet] : data.sets)
      .find((set) => set.sessionSetId === selectedSessionSetId) ?? null;
  const selectedDiscussionTarget = selectedSet && discussionScope && selectedSet.discussionAnchor
    ? { scope: discussionScope, anchor: selectedSet.discussionAnchor,
      name: `${exerciseName} · Подход ${selectedSet.position + 1}` } : null;
  const programIdentity: SetEntryProgramIdentity = context.program
    ? { programId: context.program.id, programName: context.program.name }
    : { programId: null, programName: null };

  return (
    <SessionExerciseLayout
      exerciseId={data.sessionExerciseId}
      exerciseName={exerciseName}
      media={<ExerciseMedia exercise={data.exercise} sourceUrl={data.mediaUrl} variant="thumbnail" />}
      subtitle={exerciseMeta(data)}
      badge={<Badge color="blue">{completedSets} / {totalSets}</Badge>}
      notes={data.notes}
      surface={surface}
      collapsed={controlledCollapsed}
      defaultCollapsed={defaultCollapsed}
      onCollapsedChange={onCollapsedChange}
      onInformation={onInformation}
      focusHeader={props.focusHeader} focusReady={props.focusReady}
      actions={onDeleteExercise || onInformation || (discussionScope && data.discussionAnchor) ? <ExerciseActionsMenu
        discussionTarget={discussionScope && data.discussionAnchor ? { scope: discussionScope,
          anchor: data.discussionAnchor, name: exerciseName } : null}
        onNavigationContextChange={onNavigationContextChange} onOpenDiscussion={onOpenDiscussion}
        onDelete={editable && onDeleteExercise ? () => onDeleteExercise(data.sessionExerciseId) : undefined}
        onInformation={onInformation} /> : undefined}
      onOpenExerciseMenu={onDeleteExercise || onInformation || (discussionScope && data.discussionAnchor) ? undefined
        : onOpenExerciseMenu ? () => onOpenExerciseMenu(data.sessionExerciseId) : undefined}
      onAddSet={props.mode !== 'plan' && editable && onAddSet ? () => onAddSet(data.sessionExerciseId) : undefined}
      summary={(
        <div className="session-exercise__summary">
          <div className="session-exercise__progress" role="progressbar" aria-label="Выполнение упражнения"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span className="session-exercise__progress-value" style={{ width: `${progress}%` }} />
          </div>
          <Text variant="caption" tone="muted">{progress}% выполнено</Text>
        </div>
      )}
      editor={selectedSet ? (
        props.mode === 'plan' ? (
          <SetEntry
            mode="plan"
            programExerciseId={props.programExerciseId}
            isOpen
            data={{
              identity: {
                ...programIdentity,
                exerciseDefinitionId: data.exercise.id,
                exerciseName,
                setNumber: selectedSet.position + 1,
                workoutDate: context.workoutDate,
                sourceProgramSetId: selectedSet.sourceProgramSetId,
                sessionSetId: selectedSet.sessionSetId,
              },
              trackingType: data.exercise.tracking_type,
              plan: selectedSet.plan,
              setType: selectedSet.setType ?? null,
              previous: selectedSet.previous,
              fact: selectedSet.fact,
            }}
            onClose={() => setSelectedSessionSetId(null)}
            onPlanSaved={() => props.onPlanSetSaved()}
            onOpenHistory={onOpenHistory ? () => onOpenHistory(data.exercise.id) : undefined}
            onOpenChat={onOpenChat}
          />
        ) : (
          <SetEntry
            mode="workout"
            readOnly={!editable}
            isOpen
            data={{
              identity: {
                ...programIdentity,
                exerciseDefinitionId: data.exercise.id,
                exerciseName,
                setNumber: selectedSet.position + 1,
                workoutDate: context.workoutDate,
                sourceProgramSetId: selectedSet.sourceProgramSetId,
                sessionSetId: selectedSet.sessionSetId,
              },
              trackingType: data.exercise.tracking_type,
              plan: selectedSet.plan,
              setType: selectedSet.setType ?? null,
              previous: selectedSet.previous,
              fact: selectedSet.fact,
            }}
            onClose={() => setSelectedSessionSetId(null)}
            onNavigationContextChange={onNavigationContextChange}
            discussionTarget={selectedDiscussionTarget} onOpenDiscussion={onOpenDiscussion}
            onDeleteSet={editable && onDeleteSet ? () => onDeleteSet(selectedSet.sessionSetId) : undefined}
            onSave={(fact) => props.onSaveSet({
              workoutSessionId: context.workoutSessionId,
              sessionExerciseId: data.sessionExerciseId,
              sessionSetId: selectedSet.sessionSetId,
              fact,
            })}
            onOpenHistory={onOpenHistory ? () => onOpenHistory(data.exercise.id) : undefined}
            onOpenChat={onOpenChat}
          />
        )
      ) : null}
    >
      <WorkoutExerciseSets exercise={props} onSelectSet={setSelectedSessionSetId} />
    </SessionExerciseLayout>
  );
}
