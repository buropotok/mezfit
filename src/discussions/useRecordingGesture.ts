import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { triggerTelegramSelectionHaptic } from '../telegram';
import { PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';

export type RecordingGesturePhase = 'idle' | 'pressing' | 'holding' | 'locked';
export type RecordingFinish = 'release' | 'preview' | 'send';
export const RECORDING_LOCK_DISTANCE = 96;
const CANCEL_DISTANCE = 100;

type Gesture = { id: number; x: number; y: number; timer: number; held: boolean; started: boolean; locked: boolean };

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
  const [phase, setPhase] = useState<RecordingGesturePhase>('idle');
  const [lockProgress, setLockProgress] = useState(0);

  function reset() {
    if (gesture.current) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    setPhase('idle');
    setLockProgress(0);
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

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, canRecord: boolean) {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    if (gesture.current) return;
    if (!canRecord || !['idle', 'error'].includes(latest.current.status)) return;
    const current: Gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      held: false, started: false, locked: false, timer: 0 };
    gesture.current = current;
    setPhase('pressing');
    try { event.currentTarget.setPointerCapture(current.id); } catch { /* Pointer already inactive. */ }
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
      if (!started) { setPhase('idle'); setLockProgress(0); }
    }, PRESS_SCALE_PEAK_TIME);
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || !current.started || current.locked) return;
    const up = current.y - event.clientY;
    const left = current.x - event.clientX;
    if (left >= CANCEL_DISTANCE && left > up) {
      cancel();
      triggerTelegramSelectionHaptic();
      latest.current.onCancelGesture?.();
    } else if (up > left) {
      setLockProgress(Math.max(0, Math.min(1, up / RECORDING_LOCK_DISTANCE)));
      if (up >= RECORDING_LOCK_DISTANCE) {
        current.locked = true;
        triggerTelegramSelectionHaptic();
        latest.current.onLock?.();
        setPhase('locked');
      }
    } else setLockProgress(0);
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.locked) return;
    if (current.started) finish('release');
    else if (current.held) cancel();
    else reset();
  }
  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.id === event.pointerId && !gesture.current.locked) cancel();
  }
  return { phase, lockProgress, cancel, stop: () => finish('preview'), send: () => finish('send'),
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    consumeClick: () => { const consumed = suppressClick.current; suppressClick.current = false; return consumed; } };
}
