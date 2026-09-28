/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScheduleClock } from './useScheduleClock';
import { currentLocalDate } from './dateMath';

function Clock() {
  const now = useScheduleClock();
  return <output>{currentLocalDate(now)} {now.getHours()}:{now.getMinutes()}</output>;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('schedule wall clock', () => {
  it('updates at the minute boundary, including midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 23, 59, 50));
    const view = render(<Clock />);
    expect(view.getByRole('status').textContent).toBe('2026-09-28 23:59');
    act(() => vi.advanceTimersByTime(10_000));
    expect(view.getByRole('status').textContent).toBe('2026-09-29 0:0');
  });
  it('refreshes immediately after returning to the page and clears its timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 8, 0));
    const view = render(<Clock />);
    act(() => {
      vi.setSystemTime(new Date(2026, 8, 28, 10, 30));
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(view.getByRole('status').textContent).toBe('2026-09-28 10:30');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
