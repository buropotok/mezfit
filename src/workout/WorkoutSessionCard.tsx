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
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(sqliteUtc);
  return Number.isNaN(date.getTime()) ? null : workoutTimeFormatter.format(date);
}

function workoutTimeRange(session: ActiveWorkoutSession): string {
  const start = formatWorkoutTime(session.startedAt);
  const end = formatWorkoutTime(session.completedAt);
  if (start && end) return `${start} — ${end}`;
  if (start) return `${start} — …`;
  return '—';
}

export type WorkoutSessionCardMode = 'active-program' | 'active-own' | 'completed';

export interface WorkoutSessionCardProps {
  session: ActiveWorkoutSession;
  title?: string;
  comment?: string | null;
  onReorderExerciseIds: (ids: number[]) => void;
  onSaveSet: (input: SaveSessionSetInput) => Promise<void>;
  onAddExercise?: () => void;
  onAddSet?: (sessionExerciseId: number) => void | Promise<void>;
  onRename?: (title: string) => void | Promise<void>;
  onTransfer?: () => void | Promise<void>;
  onEditResults?: () => void | Promise<void>;
  onWorkoutHistory?: () => void | Promise<void>;
  onShare?: () => void | Promise<void>;
  onCommentChange?: (comment: string) => void | Promise<void>;
  onOpenExerciseMenu?: (sessionExerciseId: number) => void;
  onOpenExerciseHistory?: (exerciseDefinitionId: number) => void;
  onOpenChat?: () => void;
}

export function WorkoutSessionCard({
  session,
  title,
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
  const sourceTitle = title ?? workoutTitle(session);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingDialog, setPendingDialog] = useState<'rename' | 'comment' | null>(null);
  const [collapsedByExerciseId, setCollapsedByExerciseId] = useState<Record<number, boolean>>({});
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(sourceTitle);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(comment ?? '');
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const active = session.status === 'active';
  const mode: WorkoutSessionCardMode = session.status === 'completed'
    ? 'completed'
    : session.program
      ? 'active-program'
      : 'active-own';

  useEffect(() => {
    if (!renameOpen) setRenameDraft(sourceTitle);
  }, [renameOpen, session.sessionId, sourceTitle]);

  useEffect(() => {
    if (!commentOpen) setCommentDraft(comment ?? '');
  }, [comment, commentOpen, session.sessionId]);

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
        onAddSet={active ? onAddSet : undefined}
        onSaveSet={onSaveSet}
        onOpenExerciseMenu={active ? onOpenExerciseMenu : undefined}
        onOpenHistory={onOpenExerciseHistory}
        onOpenChat={onOpenChat}
      />
    ),
  }));

  const menuItems: LiquidPopoverItem[] = [];
  if (mode === 'active-own' && onRename) {
    menuItems.push({
      id: 'rename',
      label: 'Изменить название',
      icon: 'pencil',
      onSelect: () => {
        setRenameDraft(sourceTitle);
        setRenameError(null);
        setPendingDialog('rename');
      },
    });
  }
  if ((mode === 'active-program' || mode === 'active-own') && onTransfer) {
    menuItems.push({
      id: 'transfer',
      label: 'Передать тренировку',
      icon: 'user-share',
      onSelect: () => void onTransfer(),
    });
  }
  if (mode === 'completed' && onEditResults) {
    menuItems.push({
      id: 'edit-results',
      label: 'Редактировать результаты',
      icon: 'edit',
      onSelect: () => void onEditResults(),
    });
  }
  if (onWorkoutHistory) {
    menuItems.push({
      id: 'history',
      label: 'История',
      icon: 'history',
      dividerBefore: menuItems.length > 0,
      onSelect: () => void onWorkoutHistory(),
    });
  }
  if (onShare) {
    menuItems.push({
      id: 'share',
      label: 'Поделиться',
      icon: 'share',
      onSelect: () => void onShare(),
    });
  }
  if (onCommentChange) {
    menuItems.push({
      id: 'comment',
      label: 'Комментарий',
      icon: 'message-circle',
      onSelect: () => {
        setCommentDraft(comment ?? '');
        setCommentError(null);
        setPendingDialog('comment');
      },
    });
  }

  const openComment = () => {
    if (!onCommentChange) return;
    setCommentDraft(comment ?? '');
    setCommentError(null);
    setCommentOpen(true);
  };

  const saveRename = async () => {
    const nextTitle = renameDraft.trim();
    if (!nextTitle || !onRename || renameSaving) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await onRename(nextTitle);
      setRenameOpen(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Не удалось изменить название');
    } finally {
      setRenameSaving(false);
    }
  };

  const saveComment = async () => {
    if (!onCommentChange || commentSaving) return;
    const nextComment = commentDraft.trim();
    setCommentSaving(true);
    setCommentError(null);
    try {
      await onCommentChange(nextComment);
      setCommentOpen(false);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Не удалось сохранить комментарий');
    } finally {
      setCommentSaving(false);
    }
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
              <Text variant="body" className="workout-session-card__workout-name">{sourceTitle}</Text>
              <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
                {workoutProgramName(session)}
              </Text>
            </div>
            {menuItems.length > 0 ? (
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
            ) : (
              <span className="workout-session-card__menu-placeholder" aria-hidden="true" />
            )}
            <Avatar
              className="workout-session-card__avatar"
              name={workoutCreatorName(session)}
              src={session.creator?.photoUrl ?? undefined}
            />
          </div>
        )}
        footer={(
          <div className="workout-session-card__footer">
            {active && onAddExercise ? (
              <GlassSurface
                component="button"
                wrapContent={false}
                shape="capsule"
                className="workout-session-card__add-exercise"
                aria-label="Добавить упражнение"
                onClick={() => onAddExercise?.()}
              >
                <Icon name="plus" variant="outline" className="workout-session-card__add-exercise-icon" />
                <Text variant="body">Добавить упражнение</Text>
              </GlassSurface>
            ) : null}

            <div className="workout-session-card__footer-meta">
              {onCommentChange ? (
                <GlassSurface
                  component="button"
                  wrapContent={false}
                  shape="capsule"
                  className="workout-session-card__comment-button"
                  aria-label="Комментарий"
                  onClick={openComment}
                >
                  <Text variant="body">Комментарий</Text>
                </GlassSurface>
              ) : null}
              <div className="workout-session-card__time">
                <Text variant="footnote" tone="muted">{formatWorkoutDate(session.workoutDate)}</Text>
                <Text variant="caption" tone="muted">{workoutTimeRange(session)}</Text>
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
          <div className="workout-session-card__dialog-content">
            <ListInput
              component="div"
              type="text"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.currentTarget.value)}
            />
            {renameError ? <Text variant="footnote" tone="muted">{renameError}</Text> : null}
          </div>
        )}
        buttons={(
          <>
            <MezfitDialogButton disabled={renameSaving} onClick={() => setRenameOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton
              strong
              disabled={renameSaving || !renameDraft.trim()}
              onClick={() => void saveRename()}
            >
              Сохранить
            </MezfitDialogButton>
          </>
        )}
        onBackdropClick={() => {
          if (!renameSaving) setRenameOpen(false);
        }}
      />

      <MezfitDialog
        opened={commentOpen}
        title="Комментарий"
        content={(
          <div className="workout-session-card__dialog-content">
            <ListInput
              component="div"
              type="textarea"
              value={commentDraft}
              placeholder="Комментарий к тренировке"
              inputClassName="!h-20 resize-none"
              onChange={(event) => setCommentDraft(event.currentTarget.value)}
            />
            {commentError ? <Text variant="footnote" tone="muted">{commentError}</Text> : null}
          </div>
        )}
        buttons={(
          <>
            <MezfitDialogButton disabled={commentSaving} onClick={() => setCommentOpen(false)}>Отмена</MezfitDialogButton>
            <MezfitDialogButton strong disabled={commentSaving} onClick={() => void saveComment()}>
              Сохранить
            </MezfitDialogButton>
          </>
        )}
        onBackdropClick={() => {
          if (!commentSaving) setCommentOpen(false);
        }}
      />
    </>
  );
}
