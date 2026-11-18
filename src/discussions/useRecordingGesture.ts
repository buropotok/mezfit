import { useEffect, useRef, useState, type PointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { runHapticProbe, triggerTelegramSelectionHaptic } from '../telegram';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';

export type RecordingGesturePhase = 'idle' | 'pressing' | 'holding' | 'locked';
export type RecordingFinish = 'release' | 'preview' | 'send';
export const RECORDING_LOCK_DISTANCE = 96;
const CANCEL_DISTANCE = 100;

type Gesture = { id: number; x: number; y: number; timer: number; held: boolean; started: boolean; locked: boolean; touchId?: number };

/** One local pointer owner for both chat recorders, including late permission grants. */
export function useRecordingGesture(options: {
  start: () => Promise<boolean>;
  finish: (mode: RecordingFinish) => void;
  cancel: () => void;
  status: 'idle' | 'requesting' | 'recording' | 'processing' | 'error';
  onCancelGesture?: () => void;
  onLock?: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const removeTouchListeners = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<RecordingGesturePhase>('idle');

  function reset() {
    removeTouchListeners.current?.();
    if (gesture.current) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    setPhase('idle');
  }
  function cancel() {
    if (gesture.current?.held) suppressClick.current = true;
    reset();
    latest.current.cancel();
  }
  function finish(mode: RecordingFinish) {
    if (!gesture.current?.started) return;
    suppressClick.current = true;
    reset();
    latest.current.finish(mode);
  }
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') cancelRef.current(); };
    const pagehide = () => cancelRef.current();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      cancelRef.current();
    };
  }, []);
  useEffect(() => {
    // Includes automatic recorder deadlines and errors, without treating the
    // initial idle render of a new press as a completed recording.
    if (gesture.current?.started && options.status !== 'recording') reset();
  }, [options.status, phase]);

  function begin(id: number, x: number, y: number) {
    const current: Gesture = { id, x, y, held: false, started: false, locked: false, timer: 0 };
    gesture.current = current;
    setPhase('pressing');
    current.timer = window.setTimeout(async () => {
      if (gesture.current !== current) return;
      current.held = true;
      suppressClick.current = true;
      setPhase('holding');
      const started = await latest.current.start();
      if (gesture.current !== current) {
        if (started) latest.current.cancel();
        return;
      }
      current.started = started;
      if (!started) setPhase('idle');
    }, PRESS_SCALE_PEAK_TIME);
  }
  function move(x: number, y: number) {
    const current = gesture.current;
    if (!current || !current.started || current.locked) return;
    const up = current.y - y;
    const left = current.x - x;
    if (left >= CANCEL_DISTANCE && left > up) {
      cancel();
      triggerTelegramSelectionHaptic();
      latest.current.onCancelGesture?.();
    } else if (up >= RECORDING_LOCK_DISTANCE && up > left) {
      current.locked = true;
      // A single success notification exactly when a real recording locks.
      runHapticProbe('telegram-success-notification');
      latest.current.onLock?.();
      setPhase('locked');
    }
  }
  function release() {
    const current = gesture.current;
    if (!current || current.locked) return;
    if (current.started) finish('release');
    else if (current.held) cancel();
    else reset();
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>, canRecord: boolean) {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    if (gesture.current) return;
    if (!canRecord || !['idle', 'error'].includes(latest.current.status)) return;
    begin(event.pointerId, event.clientX, event.clientY);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer already inactive. */ }
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.touchId !== undefined) return;
    move(event.clientX, event.clientY);
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.touchId !== undefined) return;
    release();
  }
  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    // iOS WebView can cancel PointerEvents while the same physical touch
    // remains active. Only the native touchend/touchcancel may settle it.
    if (current?.id === event.pointerId && current.touchId === undefined && !current.locked) cancel();
  }
  function onTouchStart(event: ReactTouchEvent<HTMLButtonElement>, canRecord: boolean) {
    if (event.touches.length !== 1) {
      if (gesture.current?.touchId !== undefined) cancel();
      return;
    }
    const finger = event.changedTouches[0];
    if (!finger) return;
    if (gesture.current?.locked) {
      // A new tap after locking sends via the button click, not via touchend.
      suppressClick.current = false;
      return;
    }
    if (gesture.current?.touchId !== undefined) return;
    if (!gesture.current) {
      if (!canRecord || !['idle', 'error'].includes(latest.current.status)) return;
      suppressClick.current = false;
      begin(-1, finger.clientX, finger.clientY);
    }
    const current = gesture.current;
    if (!current) return;
    current.touchId = finger.identifier;
    current.x = finger.clientX;
    current.y = finger.clientY;
    const touchId = finger.identifier;

    // Native document listeners survive pointercancel and a release outside
    // the button in iOS Telegram WebView. Pointer events remain a fallback.
    const additionalTouch = (native: TouchEvent) => {
      if (native.touches.length > 1) cancel();
    };
    const moveTouch = (native: TouchEvent) => {
      const active = gesture.current;
      if (!active || active.touchId !== touchId) return;
      if (native.touches.length !== 1) { cancel(); return; }
      const touch = Array.from(native.touches).find(item => item.identifier === touchId);
      if (!touch) return;
      if (active.held && native.cancelable) native.preventDefault();
      move(touch.clientX, touch.clientY);
    };
    const finishTouch = (native: TouchEvent, cancelled: boolean) => {
      const active = gesture.current;
      if (!active || active.touchId !== touchId) return;
      const touch = Array.from(native.changedTouches).find(item => item.identifier === touchId);
      if (!touch) return;
      if (cancelled) { cancel(); return; }
      move(touch.clientX, touch.clientY);
      if (gesture.current?.locked) {
        gesture.current.touchId = undefined;
        removeTouchListeners.current?.();
      } else release();
    };
    const endTouch = (native: TouchEvent) => finishTouch(native, false);
    const cancelTouch = (native: TouchEvent) => finishTouch(native, true);
    document.addEventListener('touchstart', additionalTouch, true);
    document.addEventListener('touchmove', moveTouch, { capture: true, passive: false });
    document.addEventListener('touchend', endTouch, true);
    document.addEventListener('touchcancel', cancelTouch, true);
    removeTouchListeners.current = () => {
      document.removeEventListener('touchstart', additionalTouch, true);
      document.removeEventListener('touchmove', moveTouch, true);
      document.removeEventListener('touchend', endTouch, true);
      document.removeEventListener('touchcancel', cancelTouch, true);
      removeTouchListeners.current = null;
    };
  }
  return { phase, cancel, stop: () => finish('preview'), send: () => finish('send'),
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onTouchStart,
    consumeClick: () => { const consumed = suppressClick.current; suppressClick.current = false; return consumed; } };
}
