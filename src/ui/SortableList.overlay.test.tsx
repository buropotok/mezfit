// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassSurfaceProvider } from './GlassSurface';
import { SortableList, type SortableListItem } from './SortableList';

const dndHarness = vi.hoisted(() => ({
  onDragStart: null as null | ((event: { active: { id: string } }) => void),
}));

vi.mock('./glassMaterial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./glassMaterial')>();
  return {
    ...actual,
    buildGlassVectorMap: vi.fn((_canvas, geometry) => ({
      href: 'data:image/png;base64,sortable-overlay-test',
      width: geometry.width,
      height: geometry.height,
    })),
  };
});

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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 320,
    bottom: 120,
    width: 320,
    height: 120,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  dndHarness.onDragStart = null;
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function liftFirstItem() {
  act(() => {
    dndHarness.onDragStart?.({ active: { id: 'first' } });
  });
}

describe('SortableList lifted overlay', () => {
  it('renders the active GlassSurface itself as the overlay with the preset material shadow', () => {
    const view = render(
      <GlassSurfaceProvider optics={false}>
        <SortableList items={items} onReorder={vi.fn()} />
      </GlassSurfaceProvider>,
    );

    liftFirstItem();

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

  it('inherits the global optics setting for the lifted GlassSurface', async () => {
    const view = render(
      <GlassSurfaceProvider optics>
        <SortableList items={items} onReorder={vi.fn()} />
      </GlassSurfaceProvider>,
    );

    liftFirstItem();

    const overlay = view.getByTestId('drag-overlay-host')
      .querySelector('.ui-sortable-list__overlay') as HTMLElement | null;

    await waitFor(() => {
      expect(overlay?.getAttribute('data-ui-glass-map-ready')).toBe('true');
    });
  });
});
