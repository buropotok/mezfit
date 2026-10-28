import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GlassSurface } from './GlassSurface';
import { DRAG_ACTIVATION_TOLERANCE, LONG_PRESS_DELAY_MS, UiPointerSensor, UiTouchSensor } from './dndSensors';
import './SortableList.css';

export type SortableListItem = {
  id: UniqueIdentifier;
  content: ReactNode;
};

export type SortableListProps = {
  items: SortableListItem[];
  onReorder: (items: SortableListItem[]) => void;
  className?: string;
  longPressDelay?: number;
  showSeparators?: boolean;
  disabled?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  surface?: 'default' | 'transparent';
  /** Fired when a long press lifts an item. Callers can prepare compact drag content. */
  onDragStart?: (id: UniqueIdentifier) => void;
  /** Keep the lifted item under its original horizontal touch coordinate. */
  lockToVerticalAxis?: boolean;
  /** Commit the visual order before dnd-kit measures the drop-animation destination. */
  syncDropLayout?: boolean;
  /** Render the lifted card outside transformed ancestors such as a bottom sheet. */
  portalOverlay?: boolean;
  /** Prevent scroll offset clamping when expanded rows collapse during a drag. */
  preserveListHeightOnDrag?: boolean;
};

const verticalOnlyModifier: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function SortableRow({ item, disabled }: { item: SortableListItem; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`ui-sortable-list__row${isDragging ? ' ui-sortable-list__row--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    >
      {item.content}
    </div>
  );
}

function SortableSurface({ transparent, children }: { transparent: boolean; children: ReactNode }) {
  return transparent ? <div className="ui-sortable-list__surface">{children}</div>
    : <GlassSurface preset="modalTuned" className="ui-sortable-list__surface">{children}</GlassSurface>;
}

export function SortableList({
  items,
  onReorder,
  className = '',
  longPressDelay = LONG_PRESS_DELAY_MS,
  showSeparators = true,
  disabled = false,
  header,
  footer,
  surface = 'default',
  onDragStart,
  lockToVerticalAxis = false,
  syncDropLayout = false,
  portalOverlay = false,
  preserveListHeightOnDrag = false,
}: SortableListProps) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [reservedHeight, setReservedHeight] = useState<number | null>(null);
  const activationConstraint = { delay: longPressDelay, tolerance: DRAG_ACTIVATION_TOLERANCE };
  const sensors = useSensors(
    useSensor(UiPointerSensor, { activationConstraint }),
    useSensor(UiTouchSensor, { activationConstraint }),
  );
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const activeItem = activeId == null ? null : items.find((item) => item.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    // Reserve before the owner collapses rows; a bottom sheet must not scroll
    // merely because its content becomes shorter under the held finger.
    if (preserveListHeightOnDrag) setReservedHeight(listRef.current?.offsetHeight ?? null);
    setActiveId(event.active.id);
    onDragStart?.(event.active.id);
  }

  function handleDragEnd(event: DragEndEvent) {
    let reorderedSuccessfully = false;
    if (event.over && event.active.id !== event.over.id) {
      const from = items.findIndex((item) => item.id === event.active.id);
      const to = items.findIndex((item) => item.id === event.over?.id);
      if (from >= 0 && to >= 0) {
        const reordered = arrayMove(items, from, to);
        reorderedSuccessfully = true;
        // With an optimistic caller, dnd-kit must measure the NEW row position
        // before starting the drop animation, not the old source position.
        if (syncDropLayout) flushSync(() => onReorder(reordered));
        else onReorder(reordered);
      }
    }
    setActiveId(null);
    // Keep the scroll range stable until the lifted overlay finishes landing.
    // A canceled/no-op drag does not require a drop animation destination.
    if (!reorderedSuccessfully) setReservedHeight(null);
  }

  const overlay = (
    <DragOverlay dropAnimation={preserveListHeightOnDrag ? {
      duration: 180, easing: 'ease-out',
      keyframes: ({ transform: { initial, final } }) => {
        const from = CSS.Transform.toString(initial);
        const to = CSS.Transform.toString(final);
        // dnd-kit skips its animation (and sideEffects cleanup) for identical
        // keyframes. Release the reserved scroll height on that path too.
        if (from === to) setReservedHeight(null);
        return [{ transform: from }, { transform: to }];
      },
      sideEffects: (args) => {
        const restore = defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })(args);
        return () => { restore?.(); setReservedHeight(null); };
      },
    } : { duration: 180, easing: 'ease-out' }}>
      {activeItem ? <GlassSurface className={`ui-sortable-list__overlay${lockToVerticalAxis ? ' ui-sortable-list__overlay--vertical' : ''}`} preset="modalTuned" halo="lifted">{activeItem.content}</GlassSurface> : null}
    </DragOverlay>
  );

  return (
    <DndContext sensors={sensors} modifiers={lockToVerticalAxis ? [verticalOnlyModifier] : undefined} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragCancel={() => { setActiveId(null); setReservedHeight(null); }} onDragEnd={handleDragEnd}>
      <SortableSurface transparent={surface === 'transparent'}>
        {header != null ? <div className="ui-sortable-list__header">{header}</div> : null}
        <div ref={listRef} style={reservedHeight === null ? undefined : { minHeight: reservedHeight }} className={`ui-sortable-list${showSeparators ? '' : ' ui-sortable-list--no-separators'} ${className}`.trim()} role="list">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {items.map((item) => <SortableRow key={item.id} item={item} disabled={disabled} />)}
          </SortableContext>
        </div>
        {footer != null ? <div className="ui-sortable-list__footer">{footer}</div> : null}
      </SortableSurface>
      {portalOverlay && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </DndContext>
  );
}
