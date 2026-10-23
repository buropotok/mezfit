// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableList, type SortableListItem } from './SortableList';

const harness = vi.hoisted(() => ({
  start: null as null | ((event: { active: { id: string } }) => void),
  end: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
  cancel: null as null | (() => void),
  dropAnimation: null as null | { sideEffects?: (args: { active: { node: HTMLElement }; dragOverlay: { node: HTMLElement } }) => (() => void) | void },
}));

vi.mock('./GlassSurface', () => ({
  GlassSurface: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }: {
      children: ReactNode;
      onDragStart: typeof harness.start;
      onDragEnd: typeof harness.end;
      onDragCancel: typeof harness.cancel;
    }) => {
      harness.start = onDragStart;
      harness.end = onDragEnd;
      harness.cancel = onDragCancel;
      return <>{children}</>;
    },
    DragOverlay: ({ children, dropAnimation }: {
      children: ReactNode; dropAnimation: typeof harness.dropAnimation;
    }) => {
      harness.dropAnimation = dropAnimation;
      return <div data-testid="lifted-overlay">{children}</div>;
    },
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
  vi.restoreAllMocks();
  harness.start = null;
  harness.end = null;
  harness.cancel = null;
  harness.dropAnimation = null;
});

function Fixture({ portal = true }: { portal?: boolean }) {
  const [ids, setIds] = useState(['first', 'second']);
  const items: SortableListItem[] = ids.map(id => ({
    id, content: <span>{id}</span>,
  }));
  return <div data-testid="transformed-sheet">
    <SortableList items={items} portalOverlay={portal} preserveListHeightOnDrag
      lockToVerticalAxis syncDropLayout
      onReorder={rows => setIds(rows.map(row => String(row.id)))} />
  </div>;
}

describe('SortableList inside an animated, scrollable sheet', () => {
  it('portals the overlay into the viewport coordinate space outside its transformed ancestor', () => {
    const view = render(<Fixture />);
    act(() => harness.start?.({ active: { id: 'first' } }));
    const lifted = document.querySelector('[data-testid="lifted-overlay"]');
    expect(lifted).not.toBeNull();
    expect(view.container.contains(lifted)).toBe(false);
    expect(lifted?.parentElement).toBe(document.body);
  });

  it('retains the original list height until the landing animation ends', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(420);
    const view = render(<Fixture />);
    const list = view.container.querySelector<HTMLElement>('.ui-sortable-list');
    expect(list?.style.minHeight).toBe('');

    act(() => harness.start?.({ active: { id: 'first' } }));
    expect(list?.style.minHeight).toBe('420px');

    act(() => harness.end?.({ active: { id: 'first' }, over: { id: 'second' } }));
    expect(list?.style.minHeight).toBe('420px');

    const cleanupDrop = harness.dropAnimation?.sideEffects?.({
      active: { node: list?.querySelector('.ui-sortable-list__row') as HTMLElement },
      dragOverlay: { node: document.querySelector('[data-testid="lifted-overlay"]') as HTMLElement },
    });
    act(() => cleanupDrop?.());
    expect(list?.style.minHeight).toBe('');
    height.mockRestore();
  });

  it('releases the reserved height on canceled drag and keeps in-place overlay by default', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(420);
    const view = render(<Fixture portal={false} />);
    expect(view.container.querySelector('[data-testid="lifted-overlay"]')).not.toBeNull();
    act(() => harness.start?.({ active: { id: 'first' } }));
    const list = view.container.querySelector<HTMLElement>('.ui-sortable-list');
    expect(list?.style.minHeight).toBe('420px');
    act(() => harness.cancel?.());
    expect(list?.style.minHeight).toBe('');
  });
});
