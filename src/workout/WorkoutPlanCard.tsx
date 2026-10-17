import { useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { List, ListItem } from 'konsta/react';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { Avatar, GlassSurface, Icon, IconButton, LiquidPopover, SortableList, Text, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import type { SetLabel } from './setEntryTypes';

export interface WorkoutPlanCardProps {
  mode: 'planning';
  day: CloudProgramDayOutline;
  creatorName: string;
  creatorAvatar?: ReactNode;
  readOnly?: boolean;
  busy?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onAddExercise?: () => void;
  onEdit: () => void;
  onComment: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function PlanGlassButton({ 'aria-disabled': disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" disabled={disabled === true || disabled === 'true'} {...props} />;
}

const setLabels: Record<SetLabel, string> = {
  warmup: 'Разминочный', easy: 'Лёгкий', normal: 'Обычный', hard: 'Тяжёлый', drop: 'Дроп-сет',
};

/** Program template mode deliberately has neither a session nor numeric PLAN/FACT.
 * The future set editor plugs into this domain instead of the legacy numeric API. */
export function WorkoutPlanCard({
  day: outline, creatorName, creatorAvatar, readOnly = false, busy = false,
  canMoveUp = false, canMoveDown = false, onEdit, onComment, onMove, onDuplicate, onDelete, onAddExercise,
}: WorkoutPlanCardProps) {
  const { day, exercises } = outline;
  const [menuOpen, setMenuOpen] = useState(false);
  const [afterMenu, setAfterMenu] = useState<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const glass = loadBrowserGlassSettings();
  const defer = (action: () => void) => {
    setAfterMenu(() => action);
    setMenuOpen(false);
  };
  const menu: LiquidPopoverItem[] = readOnly ? [] : [
    { id: 'edit', label: 'Переименовать', icon: 'pencil', disabled: busy, onSelect: () => defer(onEdit) },
    { id: 'up', label: 'Вверх', icon: 'arrow-up', disabled: busy || !canMoveUp, onSelect: () => defer(() => onMove('up')) },
    { id: 'down', label: 'Вниз', icon: 'arrow-down', disabled: busy || !canMoveDown, onSelect: () => defer(() => onMove('down')) },
    { id: 'duplicate', label: 'Дублировать', icon: 'copy-outline', disabled: busy, onSelect: () => defer(onDuplicate) },
    { id: 'comment', label: 'Комментарий', icon: 'message-circle', disabled: busy, onSelect: () => defer(onComment) },
    { id: 'start', label: 'Начать тренировку', icon: 'treadmill', disabled: true, dividerBefore: true },
    { id: 'schedule', label: 'Запланировать', icon: 'calendar-plus', disabled: true },
    { id: 'delete', label: 'Удалить', icon: 'trash-outline', disabled: busy, dividerBefore: true, onSelect: () => defer(onDelete) },
  ];
  const items = exercises.map(({ exercise: item, sets }) => ({
    id: item.id,
    content: (
      <div className="workout-plan-card__exercise">
        <Text variant="headline">{item.exercise.name}</Text>
        {item.notes ? <Text variant="footnote" tone="muted">{item.notes}</Text> : null}
        <List nested>
          {sets.map((set, index) => <ListItem key={set.id}
            title={<Text variant="body">Подход {index + 1}</Text>}
            subtitle={<div className="workout-plan-card__set-details">
              <Text variant="footnote">{setLabels[set.setLabel ?? 'normal']}</Text>
              {set.comment ? <Text variant="footnote" tone="muted">{set.comment}</Text> : null}
              {set.materialLinks?.length ? <Text variant="caption" tone="muted">Материалы: {set.materialLinks.length}</Text> : null}
              {set.chatLinks?.length ? <Text variant="caption" tone="muted">Обсуждения: {set.chatLinks.length}</Text> : null}
            </div>} />)}
        </List>
      </div>
    ),
  }));
  return <article aria-label={`День ${day.name}`}>
    <SortableList items={items} disabled showSeparators={false} onReorder={() => {}}
      header={<div className="workout-session-card__header">
        <span className="workout-session-card__icon">
          <Icon name="barbell" className="workout-session-card__icon-artwork" />
        </span>
        <div className="workout-session-card__copy">
          <Text variant="body" className="workout-session-card__workout-name">{day.name}</Text>
          <Text variant="footnote" tone="muted" className="workout-session-card__program-name">
            {day.category?.trim() || 'Без категории'}
          </Text>
        </div>
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
        <div className="workout-plan-card__avatar" aria-label={`Автор: ${creatorName}`}>
          {creatorAvatar ?? <Avatar name={creatorName} />}
        </div>
      </div>}
      footer={<div className="workout-session-card__footer">
        {!exercises.length ? <Text variant="footnote" tone="muted">В этом дне пока нет упражнений</Text> : null}
        {!readOnly ? <GlassSurface component={PlanGlassButton} wrapContent={false} shape="capsule" preset="modalTuned"
          className="workout-session-card__add-exercise" aria-disabled={busy || !onAddExercise}
          onClick={() => { if (!busy) onAddExercise?.(); }}>
          <Icon name="plus" className="workout-session-card__add-exercise-icon" />
          <Text variant="body">Добавить упражнение</Text>
        </GlassSurface> : null}
        {day.comment ? <Text variant="body" className="workout-plan-card__comment">{day.comment}</Text> : null}
        {!readOnly ? <div className="workout-plan-card__actions">
          <GlassSurface component={PlanGlassButton} wrapContent={false} shape="capsule" preset="modalTuned"
            glass={{ tintR: 244, tintG: 218, tintB: 139, tintA: 0.14 }} aria-disabled="true"
            className="workout-plan-card__action">
            <Icon name="calendar-plus" className="workout-plan-card__action-icon" />
            <Text variant="body" className="workout-plan-card__action-label">Запланировать</Text>
          </GlassSurface>
          <GlassSurface component={PlanGlassButton} wrapContent={false} shape="capsule" preset="modalTuned"
            glass={{ tintR: 155, tintG: 222, tintB: 175, tintA: 0.14 }} aria-disabled="true"
            className="workout-plan-card__action">
            <Icon name="treadmill" className="workout-plan-card__action-icon" />
            <Text variant="body">Начать</Text>
          </GlassSurface>
        </div> : null}
      </div>} />
  </article>;
}
