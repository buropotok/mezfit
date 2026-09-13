/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { List, ListItem } from './components';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListItem', () => {
  it('shows transient ripple feedback from the press position', () => {
    vi.useFakeTimers();
    render(<List><ListItem title="Кардио" /></List>);

    const item = screen.getByRole('button', { name: 'Кардио' });
    Object.defineProperty(item, 'offsetWidth', { configurable: true, value: 200 });
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 68,
      width: 200,
      height: 48,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(item, { button: 0, clientX: 60, clientY: 44 });

    const wave = item.querySelector<HTMLElement>('.ui-ripple__wave');
    expect(wave).not.toBeNull();
    expect(wave?.style.width).toBe('100px');
    expect(wave?.style.left).toBe('0px');
    expect(wave?.style.top).toBe('-26px');

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(item.querySelector('.ui-ripple__wave')).toBeNull();
  });

  it('does not mount ripple feedback for disabled or static rows', () => {
    const { rerender } = render(<List><ListItem title="Недоступно" disabled /></List>);
    expect(document.querySelector('.ui-ripple')).toBeNull();

    rerender(<List><ListItem title="Статично" interactive={false} /></List>);
    expect(document.querySelector('.ui-ripple')).toBeNull();
  });
});
