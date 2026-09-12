import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
};

function isInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button,a,input,select,textarea,[role="button"],[data-no-dnd]'));
}

class RowPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent: event }: ReactPointerEvent) => !isInteractive(event.target),
  }];
}

function SortableRow({ item }: { item: SortableListItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={`ui-sortable-list__row${isDragging ? ' ui-sortable-list__row--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      {item.content}
    </div>
  );
}

export function SortableList({ items, onReorder, className = '', longPressDelay = 300 }: SortableListProps) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(useSensor(RowPointerSensor, {
    activationConstraint: { delay: longPressDelay, tolerance: 8 },
  }));
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
      <div className={`ui-sortable-list ${className}`.trim()} role="list">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map((item) => <SortableRow key={item.id} item={item} />)}
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {activeItem ? <div className="ui-sortable-list__overlay">{activeItem.content}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
