import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
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
};

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

export function SortableList({ items, onReorder, className = '', longPressDelay = LONG_PRESS_DELAY_MS, showSeparators = true, disabled = false }: SortableListProps) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const activationConstraint = { delay: longPressDelay, tolerance: DRAG_ACTIVATION_TOLERANCE };
  const sensors = useSensors(
    useSensor(UiPointerSensor, { activationConstraint }),
    useSensor(UiTouchSensor, { activationConstraint }),
  );
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const activeItem = activeId == null ? null : items.find((item) => item.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const from = items.findIndex((item) => item.id === event.active.id);
    const to = items.findIndex((item) => item.id === event.over?.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <GlassSurface preset="modalTuned" optics={false} className="ui-sortable-list__surface">
        <div className={`ui-sortable-list${showSeparators ? '' : ' ui-sortable-list--no-separators'} ${className}`.trim()} role="list">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {items.map((item) => <SortableRow key={item.id} item={item} disabled={disabled} />)}
          </SortableContext>
        </div>
      </GlassSurface>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {activeItem ? <div className="ui-sortable-list__overlay"><GlassSurface preset="modalTuned" optics={true} glass={{ shadow: 0 }}>{activeItem.content}</GlassSurface></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
