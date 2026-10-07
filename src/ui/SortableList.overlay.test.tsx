// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurfaceProvider } from './GlassSurface';
import { SortableList, type SortableListItem } from './SortableList';

const dndHarness = vi.hoisted(() => ({
  onDragStart: null as null | ((event: { active: { id: string } }) => void),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragStart,
  }: {
    children: ReactNode;
    onDragStart: (event: { active: { id: string } }) => void;
  }) => {
    dndHarness.onDragStart = onDragStart;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => (
    <div data-testid="drag-overlay-host">{children}</div>
  ),
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  arrayMove: <T,>(items: T[]) => items,
  useSortable: ({ disabled }: { disabled: boolean }) => ({
    attributes: disabled ? {} : { role: 'button', tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

const items: SortableListItem[] = [
  { id: 'first', content: <div data-testid="first-content">Первый</div> },
  { id: 'second', content: <div>Второй</div> },
];

afterEach(() => {
  dndHarness.onDragStart = null;
  cleanup();
});

describe('SortableList lifted overlay', () => {
  it('renders the active GlassSurface itself as the overlay with the preset material shadow', () => {
    const view = render(
      <GlassSurfaceProvider optics={false}>
        <SortableList items={items} onReorder={vi.fn()} />
      </GlassSurfaceProvider>,
    );

    act(() => {
      dndHarness.onDragStart?.({ active: { id: 'first' } });
    });

    const overlayHost = view.getByTestId('drag-overlay-host');
    const overlay = overlayHost.querySelector('.ui-sortable-list__overlay') as HTMLElement | null;

    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains('ui-glass-surface')).toBe(true);
    expect(overlay?.parentElement).toBe(overlayHost);
    expect(overlay?.querySelector('.ui-glass-surface')).toBeNull();
    expect(overlay?.querySelector('[data-testid="first-content"]')).not.toBeNull();
    expect(overlay?.style.getPropertyValue('--ui-glass-surface-shadow')).toBe('0.23');
    expect(overlay?.getAttribute('data-ui-glass-map-ready')).toBe('false');
  });
});
