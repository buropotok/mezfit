import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NavigationContext } from '../NavigationShell';
import { IconButton, LiquidPopover, MezfitDialog, MezfitDialogButton, Text, type LiquidPopoverItem } from '../ui';
import { UnreadCount } from '../ui/UnreadCount';
import type { EntityDiscussionTarget } from './entity-discussion-target';
import { useEntityDiscussions } from './useEntityDiscussions';

/** The workout owns the open discussion; set-row controls never become the conversation owner. */
export function ExecutionSetDiscussionMenu({ target, setNumber, onNavigationContextChange, onDeleteNavigationContextChange, onOpenTarget, onDeleteSet }: {
  target: EntityDiscussionTarget | null;
  setNumber: number;
  onOpenTarget?: (target: EntityDiscussionTarget) => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  /** Separate navigation owner for this confirmation, above any FACT editor. */
  onDeleteNavigationContextChange?: (context: NavigationContext | null) => void;
  onDeleteSet?: () => Promise<void>;
}) {
  const discussions = useEntityDiscussions(target, onNavigationContextChange, Boolean(target), { onOpenTarget });
  const trigger = useRef<HTMLButtonElement>(null);
  const deleteRequested = useRef(false);
  const deletingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => {
    if (!deleteConfirm || !onDeleteNavigationContextChange) return;
    const report = onDeleteNavigationContextChange;
    report({
      title: 'Удалить подход?',
      onBack: () => { if (!deletingRef.current) setDeleteConfirm(false); },
    });
    return () => report(null);
  }, [deleteConfirm, onDeleteNavigationContextChange]);
  const items: LiquidPopoverItem[] = target ? [discussions.menuItem] : [];
  if (onDeleteSet) items.push({
    id: 'delete-set',
    label: 'Удалить подход',
    icon: 'trash-outline',
    dividerBefore: items.length > 0,
    disabled: deleting,
    onSelect: () => { deleteRequested.current = true; },
  });
  const onPresentationChange = (presented: boolean) => {
    discussions.onMenuPresentationChange(presented);
    if (!presented && deleteRequested.current) {
      deleteRequested.current = false;
      setDeleteError('');
      setDeleteConfirm(true);
    }
  };
  const confirmRemoval = async () => {
    if (!onDeleteSet || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteSet();
      setDeleteConfirm(false);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Не удалось удалить подход');
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };
  return <>
    <span className="session-exercise__set-actions" data-no-dnd>
      {target ? <span className="entity-discussion-trigger">
        <IconButton icon="message-circle" label={`Обсуждения подхода ${setNumber}`}
          disabled={!discussions.canOpen}
          onClick={() => onOpenTarget ? onOpenTarget(target) : discussions.open()} />
        <UnreadCount count={discussions.unread} className="entity-discussion-trigger__unread" />
      </span> : null}
      <LiquidPopover isOpen={open} onOpenChange={setOpen} triggerRef={trigger}
        label={`Меню подхода ${setNumber}`}
        trigger={<IconButton ref={trigger} icon="dots-vertical" label={`Меню подхода ${setNumber}`} />}
        items={items} onPresentationChange={onPresentationChange} />
    </span>
    {deleteConfirm && typeof document !== 'undefined' ? createPortal(
      <div className="navigation-overlay-root k-ios dark safe-areas">
        <MezfitDialog opened role="alertdialog" aria-label="Удалить подход?"
          title={<Text variant="headline">Удалить подход?</Text>}
          onBackdropClick={() => { if (!deletingRef.current) setDeleteConfirm(false); }}
          buttons={<>
            <MezfitDialogButton disabled={deleting}
              onClick={() => { if (!deletingRef.current) setDeleteConfirm(false); }}>
              <Text variant="body">Отмена</Text>
            </MezfitDialogButton>
            <MezfitDialogButton strong tone="danger" disabled={deleting} onClick={() => { void confirmRemoval(); }}>
              <Text variant="body">Удалить</Text>
            </MezfitDialogButton>
          </>}>
          <Text variant="body">Подход будет удалён только из этой тренировки.</Text>
          {deleteError ? <Text variant="footnote" role="alert">{deleteError}</Text> : null}
        </MezfitDialog>
      </div>, document.body) : null}
    {discussions.content}
  </>;
}
