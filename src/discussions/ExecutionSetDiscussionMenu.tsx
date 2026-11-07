import { useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { IconButton, LiquidPopover } from '../ui';
import { UnreadCount } from '../ui/UnreadCount';
import type { EntityDiscussionTarget } from './entity-discussion-target';
import { useEntityDiscussions } from './useEntityDiscussions';

/** A set observes its own unread; the workout owns the open conversation across deletion/reorder. */
export function ExecutionSetDiscussionMenu({ target, setNumber, onNavigationContextChange, onOpenTarget }: {
  target: EntityDiscussionTarget;
  setNumber: number;
  onOpenTarget?: (target: EntityDiscussionTarget) => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const discussions = useEntityDiscussions(target, onNavigationContextChange, true, { onOpenTarget });
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <span className="entity-discussion-trigger" data-no-dnd>
      <LiquidPopover isOpen={open} onOpenChange={setOpen} triggerRef={trigger}
        label={`Меню подхода ${setNumber}`}
        trigger={<IconButton ref={trigger} icon="dots-vertical" label={`Меню подхода ${setNumber}`} />}
        items={[discussions.menuItem]} onPresentationChange={discussions.onMenuPresentationChange} />
      {!open && <UnreadCount count={discussions.unread} className="entity-discussion-trigger__unread" />}
    </span>
    {discussions.content}
  </>;
}
