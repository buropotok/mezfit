// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscussionRecordingStatus } from './DiscussionRecordingStatus';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows elapsed recording time and replaces the swipe hint with explicit cancellation after lock', () => {
  const cancel = vi.fn();
  const { rerender } = render(<KonstaProvider theme="ios" dark>
    <DiscussionRecordingStatus locked={false} onCancel={cancel} />
  </KonstaProvider>);
  expect(screen.getByText('‹ Влево — отмена')).toBeTruthy();
  expect(screen.getByText('0:00,0')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1600));
  expect(screen.getByText('0:01,6')).toBeTruthy();
  rerender(<KonstaProvider theme="ios" dark><DiscussionRecordingStatus locked onCancel={cancel} /></KonstaProvider>);
  expect(screen.queryByText('‹ Влево — отмена')).toBeNull();
  expect(screen.getByText('0:01,6')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'ОТМЕНА' }));
  expect(cancel).toHaveBeenCalledOnce();
});
