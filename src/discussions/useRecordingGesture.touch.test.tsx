// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import { RECORDING_LOCK_DISTANCE, useRecordingGesture, type RecordingFinish } from './useRecordingGesture';

class Pointer extends MouseEvent {
  readonly pointerId = 31;
  readonly isPrimary = true;
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Harness({ finish, cancel }: { finish: (mode: RecordingFinish) => void; cancel: () => void }) {
  const [status, setStatus] = useState<'idle' | 'recording'>('idle');
  const gesture = useRecordingGesture({
    status,
    start: async () => { setStatus('recording'); return true; },
    finish: mode => { finish(mode); setStatus('idle'); },
    cancel: () => { cancel(); setStatus('idle'); },
  });
  return <button type="button" aria-label="Запись"
    onPointerDown={event => gesture.onPointerDown(event, true)}
    onTouchStart={event => gesture.onTouchStart(event, true)}
    onPointerMove={gesture.onPointerMove}
    onPointerUp={gesture.onPointerUp}
    onPointerCancel={gesture.onPointerCancel}
    onLostPointerCapture={gesture.onPointerCancel}
    onClick={() => { if (!gesture.consumeClick() && gesture.phase === 'locked') gesture.send(); }}>
    {gesture.phase}
  </button>;
}

function finger(identifier: number, x = 300, y = 600) {
  return { identifier, clientX: x, clientY: y };
}

function touchStart(id = 8) {
  const touch = finger(id);
  fireEvent.touchStart(screen.getByRole('button'), { touches: [touch], changedTouches: [touch] });
}

function nativeTouch(type: 'touchmove' | 'touchend' | 'touchcancel', id = 8, x = 300, y = 600) {
  const touch = finger(id, x, y);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === 'touchmove' ? [touch] : [] },
    changedTouches: { value: [touch] },
  });
  act(() => { document.dispatchEvent(event); });
  return event;
}

async function begin() {
  await act(async () => { await vi.advanceTimersByTimeAsync(PRESS_SCALE_PEAK_TIME); });
  expect(screen.getByRole('button').textContent).toBe('holding');
}

it('finishes a held recording on native touchend after iOS pointercancel, exactly once', async () => {
  const finish = vi.fn(), cancel = vi.fn();
  render(<Harness finish={finish} cancel={cancel} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button, { clientX: 300, clientY: 600 });
  touchStart();
  await begin();
  fireEvent.pointerCancel(button);
  fireEvent.lostPointerCapture(button);
  fireEvent.pointerUp(button);
  expect(cancel).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();

  nativeTouch('touchend');
  fireEvent.pointerUp(button);
  expect(finish).toHaveBeenCalledExactlyOnceWith('release');
  expect(cancel).not.toHaveBeenCalled();
  expect(button.textContent).toBe('idle');
});

it('keeps native upward lock recording after release, sending only on a fresh tap', async () => {
  const finish = vi.fn(), cancel = vi.fn();
  render(<Harness finish={finish} cancel={cancel} />);
  touchStart(); // Touch-only fallback when the WebView does not dispatch PointerEvents.
  await begin();
  const move = nativeTouch('touchmove', 8, 300, 600 - RECORDING_LOCK_DISTANCE);
  expect(move.defaultPrevented).toBe(true);
  expect(screen.getByRole('button').textContent).toBe('locked');
  nativeTouch('touchend', 8, 300, 600 - RECORDING_LOCK_DISTANCE);
  fireEvent.click(screen.getByRole('button')); // Suppress the lock gesture's synthetic click.
  expect(finish).not.toHaveBeenCalled();
  touchStart(9);
  nativeTouch('touchend', 9);
  fireEvent.click(screen.getByRole('button'));
  expect(finish).toHaveBeenCalledExactlyOnceWith('send');
  expect(cancel).not.toHaveBeenCalled();
});

it('treats native touchcancel and a second finger as cancellation, never a send', async () => {
  const finish = vi.fn(), cancel = vi.fn();
  render(<Harness finish={finish} cancel={cancel} />);
  touchStart();
  await begin();
  nativeTouch('touchcancel');
  expect(cancel).toHaveBeenCalledOnce();
  expect(finish).not.toHaveBeenCalled();

  touchStart(10);
  await begin();
  const another = finger(11, 310, 600);
  const original = finger(10);
  act(() => { document.dispatchEvent(Object.assign(new Event('touchstart', { bubbles: true }), {
    touches: [original, another], changedTouches: [another],
  })); });
  expect(cancel).toHaveBeenCalledTimes(2);
  nativeTouch('touchend', 10);
  expect(finish).not.toHaveBeenCalled();
});

it('ignores other fingers and removes document listeners on unmount', async () => {
  const finish = vi.fn(), cancel = vi.fn();
  const view = render(<Harness finish={finish} cancel={cancel} />);
  touchStart();
  await begin();
  nativeTouch('touchend', 42);
  expect(finish).not.toHaveBeenCalled();
  view.unmount();
  nativeTouch('touchend');
  expect(finish).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});
