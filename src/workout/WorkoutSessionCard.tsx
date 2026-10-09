import { ListInput } from 'konsta/react';
import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  GlassSurface,
  Icon,
  IconButton,
  LiquidPopover,
  MezfitDialog,
  MezfitDialogButton,
  SortableList,
  Text,
  type LiquidPopoverItem,
} from '../ui';
import { SessionExercise } from './SessionExercise';
import type { SaveSessionSetInput } from './sessionExerciseTypes';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import './workout-session-card.css';

const workoutDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const workoutTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

function workoutTitle(session: ActiveWorkoutSession): string {
  return session.day?.name ?? session.phase?.name ?? 'Своя тренировка';
}

function workoutProgramName(session: ActiveWorkoutSession): string {
  return session.program?.name ?? 'Без программы';
}

function workoutCreatorName(session: ActiveWorkoutSession): string {
  const creator = session.creator;
  if (!creator) return 'Создатель тренировки';
  const fullName = [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
  return fullName || creator.username || 'Создатель тренировки';
}

function workoutProgressPercent(session: ActiveWorkoutSession): number {
  if (session.exercises.length === 0) return 0;
  const progressSum = session.exercises.reduce((sum, exercise) => {
    const totalSets = exercise.sets.length;
    if (totalSets === 0) return sum;
    const completedSets = exercise.sets.filter((set) => set.status === 'completed').length;
    return sum + completedSets / totalSets;
  }, 0);
  return Math.round((progressSum / session.exercises.length) * 100);
}

function formatWorkoutDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return workoutDateFormatter.format(date);
}

function formatWorkoutTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : workoutTimeFormatter.format(date);
}

function workoutTimeRange(startedAt: string | null | undefined, completedAt: string | null | undefined): string {
  const start = formatWorkoutTime(startedAt);
  const end = formatWorkoutTime(completedAt);
  if (start && end) return `${start} — ${end}`;
  if (start) return `${start} — …`;
  return '—';
}

export type WorkoutSessionCardMode = 'active-program' | 'active-own' | 'completed';

export interface WorkoutSessionCardProps {
  session: ActiveWorkoutSession;
  startedAt?: string | null;
  completedAt?: string | null;
  comment?: string | null;
  onReorderExerciseIds: (ids: number[]) => void;
  onSaveSet: (input: SaveSessionSetInput) => Promise<void>;
  onAddExercise?: () => void;
  onAddSet?: (sessionExerciseId: number) => void;
  onRename?: (title: string) => void;
  onTransfer?: () => void;
  onEditResults?: () => void;
  onWorkoutHistory?: () => void;
  onShare?: () => void;
  onCommentChange?: (comment: string) => void;
  onOpenExerciseMenu?: (sessionExerciseId: number) => void;
  onOpenExerciseHistory?: (exerciseDefinitionId: number) => void;
  onOpenChat?: () => void;
}

export function WorkoutSessionCard({
  session,
  startedAt,
  completedAt,
  comment,
  onReorderExerciseIds,
  onSaveSet,
  onAddExercise,
  onAddSet,
  onRename,
  onTransfer,
  onEditResults,
  onWorkoutHistory,
  onShare,
  onCommentChange,
  onOpenExerciseMenu,
  onOpenExerciseHistory,
  onOpenChat,
}: WorkoutSessionCardProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceTitle = workoutTitle(session);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingDialog, setPendingDialog] = useState<'rename' | 'comment' | null>(null);
  const [collapsedByExerciseId, setCollapsedByExerciseId] = useState<Record<number, boolean>>({});
  const [displayTitle, setDisplayTitle] = useState(sourceTitle);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(sourceTitle);
  const [savedComment, setSavedComment] = useState(comment ?? '');
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(comment ?? '');

  const active = session.status === 'active';
  const mode: WorkoutSessionCardMode = session.status === 'completed'
    ? 'completed'
    : session.program
      ? 'active-program'
      : 'active-own';

  useEffect(() => {
    setDisplayTitle(sourceTitle);
    setRenameDraft(sourceTitle);
  }, [session.sessionId, sourceTitle]);

  useEffect(() => {
    setSavedComment(comment ?? '');
    setCommentDraft(comment ?? '');
  }, [comment, session.sessionId]);

  const progress = workoutProgressPercent(session);
  const items = session.exercises.map((exercise) => ({
    id: exercise.sessionExerciseId,
    content: (
      <SessionExercise
        context={{
          workoutSessionId: session.sessionId,
          workoutDate: session.workoutDate,
          program: session.program,
        }}
        data={exercise}
        surface="transparent"
        editable={active}
        collapsed={collapsedByExerciseId[exercise.sessionExerciseId] ?? false}
        onCollapsedChange={(collapsed) => {
          setCollapsedByExerciseId((current) => ({
            ...current,
            [exercise.sessionExerciseId]: collapsed,
          }));
        }}
        onAddSet={active ? (sessionExerciseId) => onAddSet?.(sessionExerciseId) : undefined}
        onSaveSet={onSaveSet}
        onOpenExerciseMenu={active ? onOpenExerciseMenu : undefined}
        onOpenHistory={onOpenExerciseHistory}
        onOpenChat={onOpenChat}
      />
    ),
  }));

  const menuItems: LiquidPopoverItem[] = [];
  if (mode === 'active-own') {
    menuItems.push({
      id: 'rename',
      label: 'Изменить название',
      icon: 'pencil',
      onSelect: () => {
        setRenameDraft(displayTitle);
        setPendingDialog('rename');
      },
    });
  }
  if (mode === 'active-program' || mode === 'active-own') {
    menuItems.push({
      id: 'transfer',
      label: 'Передать тренировку',
      icon: 'user-share',
      onSelect: () => onTransfer?.(),
    });
  }
  if (mode === 'completed') {
    menuItems.push({
      id: 'edit-results',
      label: 'Редактировать результаты',
      icon: 'edit',
      onSelect: () => onEditResults?.(),
    });
  }
  menuItems.push(
    {
      id: 'history',
      label: 'История',
      icon: 'history',
      dividerBefore: true,
      onSelect: () => onWorkoutHistory?.(),
    },
    {
      id: 'share',
      label: 'Поделиться',
      icon: 'share',
      onSelect: () => onShare?.(),
    },
    {
      id: 'comment',
      label: 'Комментарий',
      icon: 'message-circle',
      onSelect: () => {
        setCommentDraft(savedComment);
        setPendingDialog('comment');
      },
    },
  );

  const openComment = () => {
    setCommentDraft(savedComment);
    setCommentOpen(true);
  };

  const saveRename = () => {
    const nextTitle = renameDraft.trim();
    if (!nextTitle) return;
    setDisplayTitle(nextTitle);
    setRenameOpen(false);
    onRename?.(nextTitle);
  };

  const saveComment = () => {
    const nextComment = commentDraft.trim();
    setSavedComment(nextComment);
    setCommentOpen(false);
    onCommentChange?.(nextComment);
  };

  return (
    <>
      <SortableList
        items={items}
        disabled={!active}
        showSeparators={false}
        onReorder={(nextItems) => {
          if (!active) return;
          onReorderExerciseIds(nextItems.map((item) => Number(item.id)));
        }}
        header={(
          <div className="workout-session-card__header">
            <span className="workout-session-card__icon">
              <Icon name="barbell" variant="outline" className="workout-session-card__icon-artwork" />
            </span>
            <div className="workout-session-card__copy">
              <Text variant="body" className="workout-session-card__workout-name">{displayTitle}</Text>
              <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
                {workoutProgramName(session)}
              </Text>
            </div>
            <LiquidPopover
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              onPresentationChange={(presented) => {
                if (presented || pendingDialog === null) return;
                if (pendingDialog === 'rename') setRenameOpen(true);
                else setCommentOpen(true);
                setPendingDialog(null);
              }}
              triggerRef={menuTriggerRef}
              trigger={(
                <IconButton
                  ref={menuTriggerRef}
                  className="workout-session-card__menu-trigger"
                  style={{ width: 44, height: 44, minHeight: 44, padding: 10 }}
                  icon="dots-vertical"
                  label="Меню тренировки"
                />
              )}
              label="Меню тренировки"
              items={menuItems}
            />
            <Avatar
              className="workout-session-card__avatar"
              name={workoutCreatorName(session)}
              src={session.creator?.photoUrl ?? undefined}
            />
          </div>
        )}
        footer={(
          <div className="workout-session-card__footer">
            {active ? (
              <GlassSurface
                component="button"
                wrapContent={false}
                className="workout-session-card__add-exercise"
                aria-label="Добавить упражнение"
                onClick={() => onAddExercise?.()}
              >
                <Icon name="plus" variant="outline" className="workout-session-card__add-exercise-icon" />
                <Text variant="body">Добавить упражнение</Text>
              </GlassSurface>
            ) : null}

            <div className="workout-session-card__footer-meta">
              <GlassSurface
                component="button"
                wrapContent={false}
                className="workout-session-card__comment-button"
                aria-label="Комментарий"
                onClick={openComment}
              >
                <Text variant="body">Комментарий</Text>
              </GlassSurface>
              <div className="workout-session-card__time">
                <Text variant="footnote" tone="muted">{formatWorkoutDate(session.workoutDate)}</Text>
                <Text variant="caption" tone="muted">{workoutTimeRange(startedAt, completedAt)}</Text>
              </div>
            </div>

            <div className="workout-session-card__progress">
              <Text variant="caption" tone="muted">Прогресс</Text>
              <div
                className="workout-session-card__progress-track"
                role="progressbar"
                aria-label="Прогресс тренировки"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <span className="workout-session-card__progress-value" style={{ width: `${progress}%` }} />
              </div>
              <Text variant="caption" tone="muted">{progress}%</Text>
            </div>
          </div>
        )}
      />

      <MezfitDialog
        opened={renameOpen}
        title="Изменить название"
        content={(
          <ListInput
            component="div"
            type="text"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.currentTarget.value)}
          />
        )}
        buttons={(
          <>
            <MezfitDialogButton onClick={() => setRenameOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong disabled={!renameDraft.trim()} onClick={saveRename}>Сохранить</MezfitDialogButton>
          </>
        )}
        onBackdropClick={() => setRenameOpen(false)}
      />

      <MezfitDialog
        opened={commentOpen}
        title="Комментарий"
        content={(
          <ListInput
            component="div"
            type="textarea"
            value={commentDraft}
            placeholder="Комментарий к тренировке"
            inputClassName="!h-20 resize-none"
            onChange={(event) => setCommentDraft(event.currentTarget.value)}
          />
        )}
        buttons={(
          <>
            <MezfitDialogButton onClick={() => setCommentOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong onClick={saveComment}>Сохранить</MezfitDialogButton>
          </>
        )}
        onBackdropClick={() => setCommentOpen(false)}
      />
    </>
  );
}
