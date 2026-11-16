import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export const DISCUSSION_REPLY_SWIPE_MAX_PX = 100;
export const DISCUSSION_REPLY_SWIPE_TRIGGER_PX = 50;
const AXIS_SLOP_PX = 8;

type SwipeVisual = { offsetX: number; dragging: boolean };
type SwipePresentation = SwipeVisual & { enabled: boolean };
const idleVisual: SwipeVisual = { offsetX: 0, dragging: false };
const SwipeVisualContext = createContext<SwipePresentation>({ ...idleVisual, enabled: false });

/** Only a portaled video-note needs this: ordinary media follows its message row. */
export function useDiscussionSwipeVisual(): SwipePresentation {
  return useContext(SwipeVisualContext);
}

type Gesture = { pointerId: number; startX: number; startY: number; axis: 'pending' | 'horizontal' };

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
  const ignoreClickUntil = useRef(0);

  useEffect(() => {
    if (!enabled) {
      gesture.current = null;
      setVisual(idleVisual);
    }
  }, [enabled]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || gesture.current || event.button !== 0 || event.isPrimary === false) return;
    // Input, seek and menu controls own their gestures. Do not exclude
    // [role="dialog"]: the entire DiscussionSheet lives inside a dialog.
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, [role="slider"], [role="menu"]')) return;
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: 'pending' };
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
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
    setVisual({ offsetX: -Math.min(DISCUSSION_REPLY_SWIPE_MAX_PX, Math.max(0, -dx)), dragging: true });
  };

  const end = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    const left = current.startX - event.clientX;
    const confirmed = enabled && !cancelled && current.axis === 'horizontal' && left >= DISCUSSION_REPLY_SWIPE_TRIGGER_PX;
    if (current.axis === 'horizontal') ignoreClickUntil.current = Date.now() + 700;
    setVisual(idleVisual);
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
