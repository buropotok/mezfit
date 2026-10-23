// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableList, type SortableListItem } from './SortableList';

const dnd = vi.hoisted(() => ({
  start: null as null | ((event: { active: { id: string } }) => void),
  end: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
  cancel: null as null | (() => void),
  modifiers: undefined as unknown,
}));

vi.mock('./GlassSurface', () => ({
  GlassSurface: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children, onDragStart, onDragEnd, onDragCancel, modifiers }: {
      children: ReactNode;
      onDragStart: typeof dnd.start;
      onDragEnd: typeof dnd.end;
      onDragCancel: typeof dnd.cancel;
      modifiers?: unknown;
    }) => {
      dnd.start = onDragStart;
      dnd.end = onDragEnd;
      dnd.cancel = onDragCancel;
      dnd.modifiers = modifiers;
      return <>{children}</>;
    },
    DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
  };
});

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {}, listeners: {}, setNodeRef: vi.fn(),
      transform: null, transition: undefined, isDragging: false,
    }),
  };
});

afterEach(() => {
  cleanup();
  dnd.start = null;
  dnd.end = null;
  dnd.cancel = null;
  dnd.modifiers = undefined;
});

function TestList({ onStart }: { onStart?: (id: string | number) => void }) {
  const [ids, setIds] = useState(['first', 'second']);
  const items: SortableListItem[] = ids.map((id) => ({
    id, content: <span data-testid="sort-row">{id}</span>,
  }));
  return <SortableList items={items}
    onReorder={(next) => setIds(next.map((item) => String(item.id)))}
    onDragStart={onStart} lockToVerticalAxis syncDropLayout />;
}

describe('SortableList mobile drop coordination', () => {
  it('notifies the lift owner and keeps horizontal displacement at zero', () => {
    const onStart = vi.fn();
    render(<TestList onStart={onStart} />);

    act(() => dnd.start?.({ active: { id: 'first' } }));
    expect(onStart).toHaveBeenCalledWith('first');
    const modifiers = dnd.modifiers as Array<(arg: { transform: {
      x: number; y: number; scaleX: number; scaleY: number;
    } }) => { x: number; y: number; scaleX: number; scaleY: number }>;
    expect(modifiers).toHaveLength(1);
    expect(modifiers[0]({ transform: { x: 52, y: 38, scaleX: 1, scaleY: 1 } }))
      .toEqual({ x: 0, y: 38, scaleX: 1, scaleY: 1 });
  });

  it('commits reordered DOM before the drop handler returns so overlay lands at the target', () => {
    render(<TestList />);
    const order = () => [...document.querySelectorAll('.ui-sortable-list [data-testid="sort-row"]')]
      .map((node) => node.textContent);
    expect(order()).toEqual(['first', 'second']);

    act(() => {
      dnd.start?.({ active: { id: 'first' } });
      dnd.end?.({ active: { id: 'first' }, over: { id: 'second' } });
      expect(order()).toEqual(['second', 'first']);
    });
    expect(order()).toEqual(['second', 'first']);
  });

  it('leaves order unchanged when the touch is canceled', () => {
    render(<TestList />);
    act(() => {
      dnd.start?.({ active: { id: 'first' } });
      dnd.cancel?.();
    });
    expect(screen.getAllByTestId('sort-row').map((node) => node.textContent))
      .toEqual(['first', 'second']);
  });
});
