// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableList, type SortableListItem } from './SortableList';

const items: SortableListItem[] = [
  { id: 'first', content: <div>Первый</div> },
  { id: 'second', content: <div>Второй</div> },
];

afterEach(() => cleanup());

describe('SortableList surfaces', () => {
  it('renders one resting GlassSurface for the list and leaves resting items transparent', () => {
    const { container } = render(<SortableList items={items} onReorder={vi.fn()} />);
    const surface = container.querySelector('.ui-sortable-list__surface');

    expect(surface?.classList.contains('ui-glass-surface')).toBe(true);
    expect(surface?.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(container.querySelectorAll('.ui-sortable-list__row > .ui-glass-surface')).toHaveLength(0);
  });
});

describe('SortableList separators', () => {
  it('shows separators by default', () => {
    const { container } = render(<SortableList items={items} onReorder={vi.fn()} />);
    const list = container.querySelector('.ui-sortable-list');

    expect(list).not.toBeNull();
    expect(list?.classList.contains('ui-sortable-list--no-separators')).toBe(false);
  });

  it('supports a separator-free presentation without changing sortable mechanics', () => {
    const { container } = render(<SortableList items={items} onReorder={vi.fn()} showSeparators={false} />);
    const list = container.querySelector('.ui-sortable-list');

    expect(list).not.toBeNull();
    expect(list?.classList.contains('ui-sortable-list--no-separators')).toBe(true);
    expect(container.querySelectorAll('.ui-sortable-list__row')).toHaveLength(2);
  });
});
