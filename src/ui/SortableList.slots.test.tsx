// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableList, type SortableListItem } from './SortableList';

const items: SortableListItem[] = [
  { id: 'first', content: <div>Первый</div> },
];

afterEach(() => cleanup());

describe('SortableList header and footer slots', () => {
  it('keeps header, sortable rows, and footer inside the same GlassSurface in that order', () => {
    const { container } = render(
      <SortableList
        items={items}
        onReorder={vi.fn()}
        header={<div data-testid="header">Header</div>}
        footer={<div data-testid="footer">Footer</div>}
      />,
    );

    const surface = container.querySelector('.ui-sortable-list__surface');
    const header = container.querySelector('.ui-sortable-list__header');
    const list = container.querySelector('.ui-sortable-list');
    const footer = container.querySelector('.ui-sortable-list__footer');

    expect(surface).not.toBeNull();
    expect(header?.closest('.ui-glass-surface')).toBe(surface);
    expect(list?.closest('.ui-glass-surface')).toBe(surface);
    expect(footer?.closest('.ui-glass-surface')).toBe(surface);
    expect(header?.nextElementSibling).toBe(list);
    expect(list?.nextElementSibling).toBe(footer);
    expect(container.querySelectorAll('.ui-glass-surface')).toHaveLength(1);
  });

  it('does not reserve slot elements when header and footer are omitted', () => {
    const { container } = render(<SortableList items={items} onReorder={vi.fn()} />);

    expect(container.querySelector('.ui-sortable-list__header')).toBeNull();
    expect(container.querySelector('.ui-sortable-list__footer')).toBeNull();
  });
});
