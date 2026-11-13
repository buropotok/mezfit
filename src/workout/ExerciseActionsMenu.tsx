import { useRef, useState } from 'react';
import { IconButton, LiquidPopover } from '../ui';
import type { NavigationContext } from '../NavigationShell';
import type { EntityDiscussionTarget } from '../discussions/entity-discussion-target';
import { useEntityDiscussions } from '../discussions/useEntityDiscussions';
import { UnreadCount } from '../ui/UnreadCount';
import { loadBrowserGlassSettings } from '../glassSettings';

export function ExerciseActionsMenu({ onDelete, onInformation, busy = false, discussionTarget = null, onNavigationContextChange, onOpenDiscussion }: {
  discussionTarget?: EntityDiscussionTarget | null;
  onOpenDiscussion?: (target: EntityDiscussionTarget) => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  onDelete?: () => void;
  onInformation?: () => void;
  busy?: boolean;
}) {
  const discussions = useEntityDiscussions(discussionTarget, onNavigationContextChange, true,
    { onOpenTarget: onOpenDiscussion });
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const glass = loadBrowserGlassSettings();
  const defer = (action: (() => void) | undefined) => {
    if (!action || busy) return;
    setPending(() => action);
    setOpen(false);
  };
  return <><span className="entity-discussion-trigger"><LiquidPopover isOpen={open} onOpenChange={setOpen} triggerRef={trigger}
    preset={glass.preset} optics={glass.optics} label="Меню упражнения"
    trigger={<IconButton size="compact" ref={trigger} icon="dots-vertical" label="Меню упражнения"
      className="session-exercise__menu" data-no-dnd disabled={busy} />}
    items={[
      ...(discussionTarget ? [discussions.menuItem] : []),
      { id: 'delete', label: 'Удалить', icon: 'trash-outline', disabled: busy || !onDelete, onSelect: () => defer(onDelete) },
      { id: 'information', label: 'Информация', icon: 'info-circle', disabled: busy || !onInformation, onSelect: () => defer(onInformation) },
    ]}
    onPresentationChange={presented => {
      discussions.onMenuPresentationChange(presented);
      if (presented || !pending) return;
      const action = pending;
      setPending(null);
      action();
    }} />{!open && <UnreadCount count={discussions.unread} className="entity-discussion-trigger__unread" />}</span>
    {discussions.content}</>;
}
