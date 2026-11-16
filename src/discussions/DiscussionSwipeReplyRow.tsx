import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { Icon } from '../ui/Icon';

export const DISCUSSION_REPLY_SWIPE_MAX_PX = 100;
export const DISCUSSION_REPLY_SWIPE_TRIGGER_PX = 50;
const AXIS_SLOP_PX = 8;

type SwipeVisual = { offsetX: number; dragging: boolean; firing: boolean };
type SwipePresentation = SwipeVisual & { enabled: boolean };
const idleVisual: SwipeVisual = { offsetX: 0, dragging: false, firing: false };
const SwipeVisualContext = createContext<SwipePresentation>({ ...idleVisual, enabled: false });

/** Portaled video-note and the reply indicator share the row-owned swipe offset. */
export function useDiscussionSwipeVisual(): SwipePresentation {
  return useContext(SwipeVisualContext);
}

/** A presentation-only affordance anchored to the bubble's existing content slot.
 * Its positive local translation counteracts the row's negative translation:
 * the arrow stays in the uncovered space while the message follows the finger. */
export function DiscussionSwipeReplyIndicator() {
  const { offsetX, dragging, enabled, firing } = useDiscussionSwipeVisual();
  const distance = enabled ? Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -offsetX)) : 0;
  const progress = firing ? 1 : Math.min(1, distance / DISCUSSION_REPLY_SWIPE_TRIGGER_PX);
  const opacity = firing ? 1 : Math.max(0, Math.min(1, (distance - AXIS_SLOP_PX) / (DISCUSSION_REPLY_SWIPE_TRIGGER_PX - AXIS_SLOP_PX)));
  const scale = 0.65 + progress * 0.35;
  const circumference = 2 * Math.PI * 19;
  return <span className="discussion-reply-swipe-indicator" aria-hidden="true"
    data-armed={progress >= 1 || undefined}
    data-dragging={dragging || undefined}
    data-completing={firing || undefined}
    style={{ opacity, transform: `translate3d(${distance}px, -50%, 0) scale(${scale})` }}>
    <svg className="discussion-reply-swipe-indicator__progress" viewBox="0 0 44 44" aria-hidden="true">
      <circle className="discussion-reply-swipe-indicator__track" cx="22" cy="22" r="19" />
      <circle className="discussion-reply-swipe-indicator__fill" cx="22" cy="22" r="19"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
    </svg>
    <Icon name="reply-solid" className="discussion-reply-swipe-indicator__icon" style={{ width: 24, height: 24 }} />
  </span>;
}

type Gesture = { pointerId: number; startX: number; startY: number; axis: 'pending' | 'horizontal' };
type TouchGesture = { identifier: number; startX: number; startY: number; axis: 'pending' | 'horizontal' };

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
  const gesture = useRef<Gesture | null>(null);
  const touchGesture = useRef<TouchGesture | null>(null);
  const removeTouchListeners = useRef<(() => void) | null>(null);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const ignoreClickUntil = useRef(0);

  useEffect(() => {
    if (!enabled) {
      gesture.current = null;
      touchGesture.current = null;
      removeTouchListeners.current?.();
      setVisual(idleVisual);
    }
  }, [enabled]);
  useEffect(() => () => removeTouchListeners.current?.(), []);
  // The success burst persists briefly after the row returns to its resting
  // position. No document listeners or reply logic depend on this timer.
  useEffect(() => {
    if (!visual.firing) return;
    const timeout = window.setTimeout(() => setVisual(idleVisual), 260);
    return () => window.clearTimeout(timeout);
  }, [visual.firing]);

  const startTouch = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (touchGesture.current && event.touches.length > 1) {
      // A second finger turns this into a native multi-touch interaction.
      touchGesture.current = null;
      removeTouchListeners.current?.();
      setVisual(idleVisual);
      return;
    }
    if (!enabled || touchGesture.current || event.touches.length !== 1 || ignoresSwipe(event.target)) return;
    const finger = event.changedTouches[0];
    if (!finger) return;
    // PointerDown fires before TouchStart on phones. The native touch stream
    // owns this gesture from now on, including a circle rendered via a portal.
    gesture.current = null;
    if (visual.firing) setVisual(idleVisual);
    touchGesture.current = { identifier: finger.identifier, startX: finger.clientX,
      startY: finger.clientY, axis: 'pending' };

    // React attaches passive touchmove handlers in mobile WebViews. A temporary
    // non-passive native listener is required to hold a leftward drag without
    // the WebView stealing it and sending pointercancel after only a few px.
    const moveTouch = (moveEvent: TouchEvent) => {
      const active = touchGesture.current;
      if (!active || !enabledRef.current) return;
      if (moveEvent.touches.length !== 1) {
        touchGesture.current = null;
        removeTouchListeners.current?.();
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
      setVisual({ offsetX: -Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -dx)), dragging: true, firing: false });
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
      setVisual(confirmed ? { ...idleVisual, firing: true } : idleVisual);
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
    if (visual.firing) setVisual(idleVisual);
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: 'pending' };
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
    setVisual({ offsetX: -Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -dx)), dragging: true, firing: false });
  };

  const end = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (touchGesture.current) return;
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    const left = current.startX - event.clientX;
    const confirmed = enabled && !cancelled && current.axis === 'horizontal' && left >= DISCUSSION_REPLY_SWIPE_TRIGGER_PX;
    if (current.axis === 'horizontal') ignoreClickUntil.current = Date.now() + 700;
    setVisual(confirmed ? { ...idleVisual, firing: true } : idleVisual);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (confirmed) onReply();
  };

  return <SwipeVisualContext.Provider value={{ ...visual, enabled }}>
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
