import { useId, useState, type ReactNode } from 'react';
import type { ExerciseCategoryCode, ExerciseEquipmentCode, TrackingType } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Badge, GlassSurface, Icon, IconButton, List, ListItem, Text } from '../ui';
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

function exerciseMeta(data: SessionExerciseData): string {
  const parts: string[] = [];
  if (data.exercise.category_code) parts.push(categoryLabels[data.exercise.category_code]);
  if (data.exercise.equipment_code) parts.push(equipmentLabels[data.exercise.equipment_code]);
  parts.push(formatSetCount(data.sets.length));
  return parts.join(' · ');
}

function SetStatus({ set }: { set: SessionExerciseSetData }) {
  if (set.status === 'completed') {
    return <span className="session-exercise__set-status session-exercise__set-status--completed"><SharedIcon name="check" /></span>;
  }
  return <span className="session-exercise__set-status"><Text variant="footnote">{set.position + 1}</Text></span>;
}

function setSubtitle(set: SessionExerciseSetData, trackingType: TrackingType, planMode: boolean): ReactNode | undefined {
  const plan = formatSessionSetMetrics(set.plan, trackingType);
  const previous = formatSessionSetMetrics(set.previous?.metrics ?? null, trackingType);
  if ((!plan || planMode) && !previous) return undefined;

  return (
    <span className="session-exercise__set-context">
      {!planMode && plan ? <Text variant="caption" className="session-exercise__set-plan">План: {plan}</Text> : null}
      {previous ? <Text variant="caption" tone="muted" className="session-exercise__set-previous">Пред.: {previous}</Text> : null}
    </span>
  );
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
  collapsed: controlledCollapsed, defaultCollapsed = false, onCollapsedChange,
  onOpenExerciseMenu, actions, onAddSet, busy = false, summary, editor, children,
}: SessionExerciseLayoutProps) {
  const bodyId = useId();
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    if (controlledCollapsed === undefined) setInternalCollapsed(nextCollapsed);
    onCollapsedChange?.(nextCollapsed);
  };
  return (
    <article className={`session-exercise${surface === 'default' ? ' session-exercise--surface' : ''}`} data-session-exercise-id={typeof exerciseId === 'number' ? exerciseId : undefined}
      data-program-exercise-id={typeof exerciseId === 'string' ? exerciseId : undefined}>
      <div className="session-exercise__header">
        <List className="session-exercise__header-list">
          <ListItem
            className="session-exercise__header-toggle"
            leadingShape="square"
            leading={media}
            title={exerciseName}
            subtitle={subtitle}
            trailing={badge}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
          />
        </List>
        <IconButton
          className={`session-exercise__collapse${collapsed ? ' session-exercise__collapse--collapsed' : ''}`}
          data-no-dnd
          label={collapsed ? 'Развернуть упражнение' : 'Свернуть упражнение'}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggleCollapsed}
        >
          <SharedIcon name="chevron-down" />
        </IconButton>
        {actions ?? (onOpenExerciseMenu ? <IconButton className="session-exercise__menu"
          data-no-dnd icon="dots-vertical" label="Опции упражнения" onClick={onOpenExerciseMenu} /> : null)}
      </div>

      <div id={bodyId} className="session-exercise__body" hidden={collapsed}>
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
      </div>
      {editor}
    </article>
  );
}

const programSetLabels = {
  warmup: 'Разминочный', easy: 'Лёгкий', normal: 'Обычный', hard: 'Тяжёлый', drop: 'Дроп-сет',
};

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
      onCollapsedChange={props.onCollapsedChange}
      actions={<ExerciseActionsMenu busy={props.busy}
        onDelete={props.editable !== false ? props.onDelete : undefined} onInformation={props.onInformation} />}
      onAddSet={props.editable !== false ? props.onAddSet : undefined} busy={props.busy}
    >
      <List className="session-exercise__sets" divider="inset">
        {sets.map((set, index) => (
          <ListItem key={set.id} className="session-exercise__set-row"
            leading={<span className="session-exercise__set-status"><Text variant="footnote">{index + 1}</Text></span>}
            title={<Text variant="body">Подход {index + 1}</Text>}
            subtitle={<span className="session-exercise__set-recommendations">
              <Text variant="footnote">{programSetLabels[set.setLabel ?? 'normal']}</Text>
              {set.comment ? <Text variant="footnote" tone="muted">{set.comment}</Text> : null}
              {set.materialLinks?.length ? <Text variant="caption" tone="muted">Материалы: {set.materialLinks.length}</Text> : null}
              {set.chatLinks?.length ? <Text variant="caption" tone="muted">Обсуждения: {set.chatLinks.length}</Text> : null}
            </span>}
          />
        ))}
      </List>
    </SessionExerciseLayout>
  );
}

export function SessionExercise(props: SessionExerciseProps) {
  return props.mode === 'program' ? <ProgramExercise {...props} /> : <WorkoutExercise {...props} />;
}

function WorkoutExercise(props: WorkoutSessionExerciseProps) {
  const {
    context,
    data,
    collapsed: controlledCollapsed,
    defaultCollapsed = false,
    surface = 'default',
    editable = true,
    onAddSet,
    onCollapsedChange,
    onOpenExerciseMenu,
    onOpenHistory,
    onOpenChat,
  } = props;
  const [selectedSessionSetId, setSelectedSessionSetId] = useState<number | null>(null);
  const renderedSets = props.mode === 'plan' ? [...data.sets, props.createSet] : data.sets;
  const completedSets = data.sets.filter((set) => set.status === 'completed').length;
  const totalSets = data.sets.length;
  const progress = totalSets === 0 ? 0 : Math.round((completedSets / totalSets) * 100);
  const exerciseName = exerciseDisplayName(data.exercise);
  const selectedSet = selectedSessionSetId === null
    ? null
    : renderedSets.find((set) => set.sessionSetId === selectedSessionSetId) ?? null;
  const programIdentity: SetEntryProgramIdentity = context.program
    ? { programId: context.program.id, programName: context.program.name }
    : { programId: null, programName: null };

  return (
    <SessionExerciseLayout
      exerciseId={data.sessionExerciseId}
      exerciseName={exerciseName}
      media={<ExerciseMedia exercise={data.exercise} variant="thumbnail" />}
      subtitle={exerciseMeta(data)}
      badge={<Badge color="blue">{completedSets} / {totalSets}</Badge>}
      notes={data.notes}
      surface={surface}
      collapsed={controlledCollapsed}
      defaultCollapsed={defaultCollapsed}
      onCollapsedChange={onCollapsedChange}
      onOpenExerciseMenu={onOpenExerciseMenu ? () => onOpenExerciseMenu(data.sessionExerciseId) : undefined}
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
              previous: selectedSet.previous,
              fact: selectedSet.fact,
            }}
            onClose={() => setSelectedSessionSetId(null)}
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
      <List className="session-exercise__sets" divider="inset">
        {renderedSets.map((set) => {
          const setNumber = set.position + 1;
          const planMode = props.mode === 'plan';
          const metrics = formatSessionSetMetrics(
            planMode ? set.plan : set.fact?.metrics ?? null,
            data.exercise.tracking_type,
          );
          const canOpenSet = planMode ? set.sourceProgramSetId === null : editable;
          return (
            <ListItem
              key={set.sessionSetId}
              className="session-exercise__set-row"
              leading={<SetStatus set={set} />}
              title={(
                <span className="session-exercise__set-title">
                  <span>Подход {setNumber}</span>
                  <span className={`session-exercise__set-fact${metrics ? '' : ' session-exercise__set-fact--empty'}`}>
                    {metrics ?? (planMode ? 'ввести план' : 'ввести факт')}
                  </span>
                </span>
              )}
              subtitle={setSubtitle(set, data.exercise.tracking_type, planMode)}
              trailing={(
                <span className="session-exercise__set-trailing">
                  {!planMode && set.fact?.rpe !== null && set.fact?.rpe !== undefined ? <Badge color="gray">RPE {set.fact.rpe}</Badge> : null}
                  {canOpenSet ? <SharedIcon name="chevron-right" /> : null}
                </span>
              )}
              aria-label={canOpenSet ? `Открыть подход ${setNumber}` : undefined}
              onClick={canOpenSet ? () => setSelectedSessionSetId(set.sessionSetId) : undefined}
            />
          );
        })}
      </List>
    </SessionExerciseLayout>
  );
}
