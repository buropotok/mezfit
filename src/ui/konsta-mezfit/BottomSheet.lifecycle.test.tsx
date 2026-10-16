// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitBottomSheet } from './BottomSheet';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MezfitBottomSheet lazy content lifecycle', () => {
  it('finishes closing without transitionend using the rendered transition timing, once only', () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const view = (opened: boolean) => (
      <MezfitBottomSheet opened={opened} label="Выбор" lazyMount onClosed={onClosed}
        style={{ transitionDuration: '50ms, 0.2s', transitionDelay: '0s, 0.05s' }}>
        <button>Содержимое</button>
      </MezfitBottomSheet>
    );
    const { container, rerender } = render(view(false));
    const shell = container.querySelector('[aria-label="Выбор"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Missing sheet');
    expect(screen.queryByText('Содержимое')).toBeNull();
    act(() => vi.runAllTimers());
    expect(onClosed).not.toHaveBeenCalled();

    rerender(view(true));
    expect(screen.getByRole('dialog', { name: 'Выбор' })).toBe(shell);
    rerender(view(false));
    fireEvent.transitionEnd(screen.getByText('Содержимое'));
    act(() => vi.advanceTimersByTime(249));
    expect(screen.queryByText('Содержимое')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Содержимое')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    fireEvent.transitionEnd(shell);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('cancels pending disposal on reopening and cancels the timer on unmount', () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const view = (opened: boolean) => (
      <MezfitBottomSheet opened={opened} label="Выбор" lazyMount onClosed={onClosed}
        style={{ transitionDuration: '200ms' }}>
        <button>Содержимое</button>
      </MezfitBottomSheet>
    );
    const { rerender, unmount } = render(view(true));
    rerender(view(false));
    act(() => vi.advanceTimersByTime(100));
    rerender(view(true));
    act(() => vi.runAllTimers());
    expect(screen.getByRole('button', { name: 'Содержимое' })).toBeTruthy();
    expect(onClosed).not.toHaveBeenCalled();

    rerender(view(false));
    unmount();
    act(() => vi.runAllTimers());
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('cleans up when transitions are disabled and preserves eager content by default', () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const view = (opened: boolean, lazyMount: boolean) => (
      <MezfitBottomSheet opened={opened} label="Выбор" lazyMount={lazyMount} onClosed={onClosed}
        style={{ transitionProperty: 'none', transitionDuration: '200ms' }}>
        <button>Содержимое</button>
      </MezfitBottomSheet>
    );
    const { rerender } = render(view(true, true));
    rerender(view(false, true));
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByText('Содержимое')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);

    rerender(<MezfitBottomSheet opened={false} label="Выбор"><button>Содержимое</button></MezfitBottomSheet>);
    expect(screen.queryByText('Содержимое')).not.toBeNull();
  });
});
