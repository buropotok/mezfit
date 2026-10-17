import { useLayoutEffect, useRef, type RefObject } from 'react';
import { PHASE_MOTION_MS, phaseDayPosition } from './phaseDayMotion';

/** Own wrappers only: the UI Kit keeps full ownership of each card's DOM. */
export function usePhaseDayMotion(collapsed: boolean, viewport: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>, nodes: RefObject<Map<string, HTMLDivElement>>) {
  const previous = useRef(collapsed);
  const active = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const outer = viewport.current, inner = content.current;
    if (!outer || !inner) return;
    const wasCollapsed = previous.current;
    const interrupted = active.current.length > 0;
    const changed = wasCollapsed !== collapsed;
    previous.current = collapsed;
    // Capture current presentation before cancellation, including interrupted toggles.
    const startHeight = outer.getBoundingClientRect().height;
    const starts = new Map([...nodes.current].map(([id, node]) =>
      [id, node.getBoundingClientRect().top - inner.getBoundingClientRect().top]));
    active.current.forEach(animation => animation.cancel());
    active.current = [];
    outer.style.height = collapsed ? '0px' : 'auto';
    outer.style.visibility = collapsed ? 'hidden' : 'visible';
    if (!changed || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !outer.animate) return;
    const baseline = [...nodes.current.values()][0]?.offsetTop ?? 0;
    const slots = [...nodes.current].map(([id, node]) => ({ id, node, top: node.offsetTop - baseline }));
    const maximum = Math.max(0, ...slots.map(slot => slot.top));
    outer.style.visibility = 'visible';
    const framesBySlot = slots.map(({ id, node, top }) => {
      const start = interrupted ? (starts.get(id) ?? baseline) - baseline : wasCollapsed ? 0 : top;
      const frames = Array.from({ length: 61 }, (_, step) => {
        const progress = step / 60;
        const position = collapsed
          ? phaseDayPosition(top, maximum, 1 - progress)
          : phaseDayPosition(top, maximum, progress);
        const canonicalStart = collapsed ? top : 0;
        return position + (start - canonicalStart) * (1 - progress);
      });
      return { node, top, frames, height: node.offsetHeight };
    });
    // At opening frame zero, the full stack is already visible. Its enclosing
    // height follows the moving cards; it must not reveal them through a zero-height clip.
    const heightFrames = Array.from({ length: 61 }, (_, step) => {
      const bound = baseline + Math.max(0, ...framesBySlot.map(slot => slot.frames[step] + slot.height));
      return { height: `${interrupted && step === 0 ? startHeight : bound}px`, offset: step / 60 };
    });
    const height = outer.animate(heightFrames, { duration: PHASE_MOTION_MS, easing: 'linear' });
    active.current.push(height);
    for (const { node, top, frames } of framesBySlot) {
      active.current.push(node.animate(frames.map((position, step) => ({
        transform: `translateY(${position - top}px)`, offset: step / 60,
      })), { duration: PHASE_MOTION_MS, easing: 'linear' }));
    }
    height.onfinish = () => {
      outer.style.visibility = collapsed ? 'hidden' : 'visible';
      outer.style.height = collapsed ? '0px' : 'auto';
      active.current.forEach(animation => animation.cancel());
      active.current = [];
    };
    return () => {
      // Cleanup on unmount. Toggle interruptions are captured by the next effect.
      height.onfinish = null;
    };
  }, [collapsed, viewport, content, nodes]);
  useLayoutEffect(() => () => {
    active.current.forEach(animation => animation.cancel());
    active.current = [];
  }, []);
}
