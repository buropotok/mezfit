// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionSetFocus } from './DiscussionSetFocus';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('does not flash while its containing sheet is opening, then flashes only once', () => {
  const onClick = vi.fn();
  const view = render(<DiscussionSetFocus ready={false}>
    <button type="button" onClick={onClick}>Подход 2</button>
  </DiscussionSetFocus>);
  expect(view.container.querySelector('.discussion-set-focus__flash')).toBeNull();
  view.rerender(<DiscussionSetFocus ready>
    <button type="button" onClick={onClick}>Подход 2</button>
  </DiscussionSetFocus>);
  const flash = view.container.querySelector('.discussion-set-focus__flash');
  expect(flash).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подход 2' }));
  expect(onClick).toHaveBeenCalledOnce();
  view.rerender(<DiscussionSetFocus ready>
    <button type="button" onClick={onClick}>Подход 2</button>
  </DiscussionSetFocus>);
  expect(view.container.querySelector('.discussion-set-focus__flash')).toBe(flash);
});
