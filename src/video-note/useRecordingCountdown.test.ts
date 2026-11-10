// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecordingCountdown } from './useRecordingCountdown';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([5, 10, 15])('starts exactly once after %s seconds', seconds => {
  const complete = vi.fn();
  const { result } = renderHook(() => useRecordingCountdown(complete));
  act(() => result.current.schedule(seconds));
  act(() => vi.advanceTimersByTime((seconds - 1) * 1000));
  expect(complete).not.toHaveBeenCalled();
  expect(result.current.remaining).toBe(1);
  act(() => vi.advanceTimersByTime(1000));
  expect(complete).toHaveBeenCalledOnce();
  expect(result.current.remaining).toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(complete).toHaveBeenCalledOnce();
});

it.each(['cancel', 'background', 'unmount'])('does not start after %s', action => {
  const complete = vi.fn();
  const { result, unmount } = renderHook(() => useRecordingCountdown(complete));
  act(() => result.current.schedule(5));
  act(() => {
    if (action === 'cancel') result.current.cancel();
    else if (action === 'background') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } else unmount();
    vi.advanceTimersByTime(10_000);
  });
  expect(complete).not.toHaveBeenCalled();
});
