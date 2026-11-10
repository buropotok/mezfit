// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import { RECORDING_LOCK_DISTANCE, useRecordingGesture, type RecordingFinish } from './useRecordingGesture';

class Pointer extends MouseEvent {
  readonly pointerId = 1;
  readonly isPrimary = true;
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ start = async () => true, finish, cancel, onCancelGesture }: {
  start?: () => Promise<boolean>;
  finish: (mode: RecordingFinish) => void;
  cancel: () => void;
  onCancelGesture?: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'recording'>('idle');
  const gesture = useRecordingGesture({ status,
    start: async () => { const started = await start(); if (started) setStatus('recording'); return started; },
    finish: mode => { finish(mode); setStatus('idle'); }, cancel, onCancelGesture,
  });
  return <>
    <button aria-label="Запись" onPointerDown={event => gesture.onPointerDown(event, true)}
      onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp}
      onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onPointerCancel}
      onClick={() => { if (!gesture.consumeClick() && gesture.phase === 'locked') gesture.send(); }}>
      {gesture.phase}
    </button>
    <button onClick={gesture.stop}>Стоп</button>
  </>;
}
const down = { clientX: 300, clientY: 600 };
async function hold() {
  fireEvent.pointerDown(screen.getByLabelText('Запись'), down);
  await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });
}
function lock() {
  fireEvent.pointerMove(screen.getByLabelText('Запись'), { clientX: 300, clientY: 600 - RECORDING_LOCK_DISTANCE });
}

it('starts at the press animation peak, while a shorter tap never starts recording', async () => {
  const start = vi.fn(async () => true);
  render(<Harness start={start} finish={vi.fn()} cancel={vi.fn()} />);
  const button = screen.getByLabelText('Запись');
  fireEvent.pointerDown(button, down);
  act(() => vi.advanceTimersByTime(PRESS_SCALE_PEAK_TIME - 1));
  expect(start).not.toHaveBeenCalled();
  fireEvent.pointerUp(button);
  act(() => vi.advanceTimersByTime(1000));
  expect(start).not.toHaveBeenCalled();
  await hold();
  expect(start).toHaveBeenCalledOnce();
  expect(button.textContent).toBe('holding');
});

it('keeps recording after upward lock, release and loss of capture; Stop selects review', async () => {
  const finish = vi.fn(), cancel = vi.fn();
  render(<Harness finish={finish} cancel={cancel} />);
  await hold(); lock();
  const button = screen.getByLabelText('Запись');
  expect(button.textContent).toBe('locked');
  fireEvent.pointerUp(button);
  fireEvent.lostPointerCapture(button);
  fireEvent.click(button, { detail: 1 });
  expect(finish).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Стоп'));
  expect(finish).toHaveBeenCalledExactlyOnceWith('preview');
  expect(button.textContent).toBe('idle');
});

it('sends a locked recording only on a new explicit tap', async () => {
  const finish = vi.fn();
  render(<Harness finish={finish} cancel={vi.fn()} />);
  await hold(); lock();
  const button = screen.getByLabelText('Запись');
  fireEvent.pointerUp(button);
  // Even if the WebView did not synthesize a click for the swipe, the next tap works.
  fireEvent.pointerDown(button, down);
  fireEvent.pointerUp(button);
  fireEvent.click(button, { detail: 1 });
  expect(finish).toHaveBeenCalledExactlyOnceWith('send');
});

it('small movement preserves ordinary release and left swipe discards immediately', async () => {
  const finish = vi.fn(), cancel = vi.fn(), onCancelGesture = vi.fn();
  render(<Harness finish={finish} cancel={cancel} onCancelGesture={onCancelGesture} />);
  await hold();
  const button = screen.getByLabelText('Запись');
  fireEvent.pointerMove(button, { clientX: 290, clientY: 590 });
  fireEvent.pointerUp(button);
  expect(finish).toHaveBeenCalledExactlyOnceWith('release');
  await hold();
  fireEvent.pointerMove(button, { clientX: 180, clientY: 590 });
  expect(cancel).toHaveBeenCalledOnce();
  expect(onCancelGesture).toHaveBeenCalledOnce();
  fireEvent.pointerUp(button);
  expect(finish).toHaveBeenCalledOnce();
});

it('discards a start that completes after pointer cancellation', async () => {
  let grant: ((started: boolean) => void) | undefined;
  const start = () => new Promise<boolean>(resolve => { grant = resolve; });
  const finish = vi.fn(), cancel = vi.fn();
  render(<Harness start={start} finish={finish} cancel={cancel} />);
  await hold();
  fireEvent.pointerCancel(screen.getByLabelText('Запись'));
  await act(async () => { grant?.(true); });
  expect(cancel).toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Запись').textContent).toBe('idle');
});

it('cancels a locked recording when the page is hidden', async () => {
  const cancel = vi.fn(), finish = vi.fn();
  render(<Harness finish={finish} cancel={cancel} />);
  await hold(); lock();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(cancel).toHaveBeenCalledOnce();
  expect(finish).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Запись').textContent).toBe('idle');
});
