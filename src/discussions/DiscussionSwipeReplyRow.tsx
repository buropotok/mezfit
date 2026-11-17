import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { Icon } from '../ui/Icon';
import { runHapticProbe } from '../telegram';

export const DISCUSSION_REPLY_SWIPE_MAX_PX = 100;
export const DISCUSSION_REPLY_SWIPE_TRIGGER_PX = 60;
const AXIS_SLOP_PX = 8;

type SwipeVisual = { offsetX: number; dragging: boolean };
type SwipePresentation = SwipeVisual & { enabled: boolean; pulsing: boolean; completed: boolean };
const idleVisual: SwipeVisual = { offsetX: 0, dragging: false };
const SwipeVisualContext = createContext<SwipePresentation>({ ...idleVisual, enabled: false, pulsing: false, completed: false });

/** Portaled video-note and the reply indicator share the row-owned swipe offset. */
export function useDiscussionSwipeVisual(): SwipePresentation {
  return useContext(SwipeVisualContext);
}

/** Gap geometry owns both the moving cue and the ring.
 * The gap begins at the displaced bubble's right edge and ends at its
 * original right edge. Its width equals the swipe distance, so the cue
 * travels exactly half as far as the message. The circle and ring are
 * always constrained to the gap minus 4 CSS px on either side. */
export function DiscussionSwipeReplyIndicator() {
  const { offsetX, dragging, enabled, pulsing, completed } = useDiscussionSwipeVisual();
  const distance = enabled ? Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -offsetX)) : 0;
  const progress = completed ? 1 : Math.min(1, distance / DISCUSSION_REPLY_SWIPE_TRIGGER_PX);
  const opacity = Math.min(1, Math.max(0, (distance - AXIS_SLOP_PX) / 26));
  const circumference = 2 * Math.PI * 15.5;
  return <span className="discussion-reply-swipe-indicator" aria-hidden="true"
    data-armed={progress >= 1 || undefined}
    data-dragging={dragging || undefined}
    data-pulsing={pulsing || undefined}
    data-completed={completed || undefined}
    style={{ width: `${distance}px`, opacity }}>
    <span className="discussion-reply-swipe-indicator__circle">
      <span className="discussion-reply-swipe-indicator__icon"><Icon name="reply-solid" /></span>
    </span>
    <svg className="discussion-reply-swipe-indicator__progress" viewBox="0 0 34 34" aria-hidden="true">
      <circle className="discussion-reply-swipe-indicator__track" cx="17" cy="17" r="15.5" />
      <circle className="discussion-reply-swipe-indicator__fill" cx="17" cy="17" r="15.5"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
    </svg>
  </span>;
}

type Gesture = { pointerId: number; startX: number; startY: number; axis: 'pending' | 'horizontal'; pulsed: boolean };
type TouchGesture = { identifier: number; startX: number; startY: number; axis: 'pending' | 'horizontal'; pulsed: boolean };

/** The reply gesture is touch-first in Telegram WebViews; PointerEvents remain a fallback. */
function ignoresSwipe(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, [role="slider"], [role="menu"]'));
}

export function DiscussionSwipeReplyRow({ children, messageId, own, highlighted, enabled, onReply, rowRef }: {
  children: ReactNode;
  messageId: string;
  own: boolean;
  highlighted: boolean;
  enabled: boolean;
  onReply: () => void;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  const [visual, setVisual] = useState<SwipeVisual>(idleVisual);
  const [pulsing, setPulsing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const pulseTimer = useRef<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const touchGesture = useRef<TouchGesture | null>(null);
  const removeTouchListeners = useRef<(() => void) | null>(null);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const ignoreClickUntil = useRef(0);

  const clearPulse = () => {
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = null;
    setPulsing(false);
  };
  const updateSwipe = (dx: number, active: Gesture | TouchGesture) => {
    const distance = Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -dx));
    setVisual({ offsetX: -distance, dragging: true });
    if (!active.pulsed && distance >= DISCUSSION_REPLY_SWIPE_TRIGGER_PX) {
      active.pulsed = true;
      clearPulse();
      setCompleted(true);
      setPulsing(true);
      // Exactly the Telegram success notification probe, once per gesture.
      runHapticProbe('telegram-success-notification');
      pulseTimer.current = window.setTimeout(() => {
        pulseTimer.current = null;
        setPulsing(false);
      }, 300);
    }
  };

  useEffect(() => {
    if (!enabled) {
      gesture.current = null;
      touchGesture.current = null;
      removeTouchListeners.current?.();
      clearPulse();
      setCompleted(false);
      setVisual(idleVisual);
    }
  }, [enabled]);
  useEffect(() => () => {
    removeTouchListeners.current?.();
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
  }, []);

  const startTouch = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (touchGesture.current && event.touches.length > 1) {
      // A second finger turns this into a native multi-touch interaction.
      touchGesture.current = null;
      removeTouchListeners.current?.();
      clearPulse();
      setVisual(idleVisual);
      return;
    }
    if (!enabled || touchGesture.current || event.touches.length !== 1 || ignoresSwipe(event.target)) return;
    const finger = event.changedTouches[0];
    if (!finger) return;
    // PointerDown fires before TouchStart on phones. The native touch stream
    // owns this gesture from now on, including a circle rendered via a portal.
    gesture.current = null;
    clearPulse();
    setCompleted(false);
    touchGesture.current = { identifier: finger.identifier, startX: finger.clientX,
      startY: finger.clientY, axis: 'pending', pulsed: false };

    // React attaches passive touchmove handlers in mobile WebViews. A temporary
    // non-passive native listener is required to hold a leftward drag without
    // the WebView stealing it and sending pointercancel after only a few px.
    const moveTouch = (moveEvent: TouchEvent) => {
      const active = touchGesture.current;
      if (!active || !enabledRef.current) return;
      if (moveEvent.touches.length !== 1) {
        touchGesture.current = null;
        removeTouchListeners.current?.();
        clearPulse();
        setVisual(idleVisual);
        return;
      }
      const touch = Array.from(moveEvent.touches).find(item => item.identifier === active.identifier);
      if (!touch) return;
      const dx = touch.clientX - active.startX;
      const dy = touch.clientY - active.startY;
      if (active.axis === 'pending') {
        if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return;
        if (dx > AXIS_SLOP_PX || (Math.abs(dy) >= AXIS_SLOP_PX
          && Math.abs(dy) > Math.abs(dx))) {
          touchGesture.current = null;
          removeTouchListeners.current?.();
          return;
        }
        if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) return;
        active.axis = 'horizontal';
      }
      if (moveEvent.cancelable) moveEvent.preventDefault();
      updateSwipe(dx, active);
    };

    const finishTouch = (endEvent: TouchEvent, cancelled: boolean) => {
      const active = touchGesture.current;
      if (!active) return;
      const touch = Array.from(endEvent.changedTouches).find(item => item.identifier === active.identifier);
      if (!touch) return;
      touchGesture.current = null;
      removeTouchListeners.current?.();
      const left = active.startX - touch.clientX;
      const confirmed = enabledRef.current && !cancelled && active.axis === 'horizontal'
        && left >= DISCUSSION_REPLY_SWIPE_TRIGGER_PX;
      if (active.axis === 'horizontal') ignoreClickUntil.current = Date.now() + 700;
      clearPulse();
      setVisual(idleVisual);
      if (confirmed) onReplyRef.current();
    };
    const endTouch = (endEvent: TouchEvent) => finishTouch(endEvent, false);
    const cancelTouch = (endEvent: TouchEvent) => finishTouch(endEvent, true);
    document.addEventListener('touchmove', moveTouch, { capture: true, passive: false });
    document.addEventListener('touchend', endTouch, true);
    document.addEventListener('touchcancel', cancelTouch, true);
    removeTouchListeners.current = () => {
      document.removeEventListener('touchmove', moveTouch, true);
      document.removeEventListener('touchend', endTouch, true);
      document.removeEventListener('touchcancel', cancelTouch, true);
      removeTouchListeners.current = null;
    };
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || touchGesture.current || gesture.current || event.button !== 0 || event.isPrimary === false) return;
    // Pointer fallback is retained for mouse/pen and synthetic pointer tests.
    if (ignoresSwipe(event.target)) return;
    clearPulse();
    setCompleted(false);
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: 'pending', pulsed: false };
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || touchGesture.current) return;
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (current.axis === 'pending') {
      if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return;
      // Vertical scrolling and rightward gestures remain entirely native.
      if (dx >= 0 || Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return; }
      current.axis = 'horizontal';
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Portal/WebView may disallow capture. */ }
    }
    updateSwipe(dx, current);
  };

  const end = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (touchGesture.current) return;
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    const left = current.startX - event.clientX;
    const confirmed = enabled && !cancelled && current.axis === 'horizontal' && left >= DISCUSSION_REPLY_SWIPE_TRIGGER_PX;
    if (current.axis === 'horizontal') ignoreClickUntil.current = Date.now() + 700;
    clearPulse();
    setVisual(idleVisual);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (confirmed) onReply();
  };

  return <SwipeVisualContext.Provider value={{ ...visual, enabled, pulsing, completed }}>
    <div className="discussion-message-target discussion-message-target--reply-swipe"
      data-message-id={messageId} data-own={String(own)}
      data-highlighted={highlighted || undefined}
      data-swipe-dragging={visual.dragging || undefined}
      ref={rowRef}
      style={visual.offsetX ? { transform: `translate3d(${visual.offsetX}px, 0, 0)` } : undefined}
      onTouchStart={startTouch}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={event => end(event, false)}
      onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}
      onClickCapture={event => {
        if (Date.now() <= ignoreClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
      }}>
      {children}
    </div>
  </SwipeVisualContext.Provider>;
}
