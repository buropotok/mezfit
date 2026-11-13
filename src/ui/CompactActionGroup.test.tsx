// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactActionGroup, IconButton } from './index';

afterEach(cleanup);

it.each([2, 3, 4])('renders %i independent 44px action slots without extra gaps', (count) => {
  const activated = vi.fn();
  const view = render(<CompactActionGroup aria-label="Действия">
    {Array.from({ length: count }, (_, index) =>
      <IconButton key={index} size="compact" icon="dots-vertical" label={`Действие ${index + 1}`}
        onClick={() => activated(index)} />)}
  </CompactActionGroup>);
  const group = screen.getByRole('group', { name: 'Действия' });
  expect(group.classList.contains('ui-compact-action-group')).toBe(true);
  expect(group.querySelectorAll('.ui-compact-action-group__slot')).toHaveLength(count);
  expect(group.querySelectorAll('.ui-icon-button--compact')).toHaveLength(count);
  fireEvent.click(screen.getByRole('button', { name: `Действие ${count}` }));
  expect(activated).toHaveBeenCalledWith(count - 1);
  view.unmount();
});
