import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createLiquidMotion, type LiquidRect } from './liquidPopoverGeometry';
import { contourBounds } from './liquidPopoverCanvas';

export type LiquidCollapseBounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
export interface LiquidCollapseProps {
  /** Measured by the source owner before its local mutation removes the card. */
  source: LiquidCollapseBounds;
  targetRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onFinished: () => void;
}
const liquidRect = (rect: LiquidCollapseBounds): LiquidRect => ({
  x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height,
});

/** Reverse LiquidPopover geometry for live React content, with no DOM screenshots.
 * Owns only presentation: persistence must already have accepted the cancellation.
 */
export function LiquidCollapse({ source, targetRef, children, onFinished }: LiquidCollapseProps) {
  const clipId = useId().replace(/:/g, '');
  const contourRef = useRef<SVGPathElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef(onFinished);
  finishRef.current = onFinished;
  useLayoutEffect(() => {
    const target = targetRef.current?.getBoundingClientRect();
    const content = contentRef.current;
    if (!target?.width || !target.height || !source.width || !source.height || !content
      || source.top >= window.innerHeight || source.top + source.height <= 0
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishRef.current();
      return;
    }
    const motion = createLiquidMotion(liquidRect(target), liquidRect(source));
    let frame = 0;
    let stopped = false;
    const start = performance.now();
    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      finishRef.current();
    };
    const draw = (time: number) => {
      if (stopped) return;
      const elapsed = Math.min(1, Math.max(0, (time - start) / (motion.totalSeconds * 1000)));
      const loops = motion.contour(1 - elapsed);
      const bounds = contourBounds(loops);
      contourRef.current?.setAttribute('d', motion.path(loops));
      content.style.transform = `translate(${bounds.left}px, ${bounds.top}px) scale(${(bounds.right - bounds.left) / source.width}, ${(bounds.bottom - bounds.top) / source.height})`;
      // Disappear into the basket at the end, keeping its icon visible throughout.
      content.style.opacity = String(Math.min(1, (1 - elapsed) / 0.12));
      if (elapsed < 1) frame = requestAnimationFrame(draw);
      else finish();
    };
    draw(start);
    window.addEventListener('resize', finish);
    window.visualViewport?.addEventListener('resize', finish);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', finish);
      window.visualViewport?.removeEventListener('resize', finish);
    };
  }, [source, targetRef]);
  return createPortal(<div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' }}>
    <svg width="0" height="0"><defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><path ref={contourRef} /></clipPath></defs></svg>
    <div style={{ position: 'absolute', inset: 0, clipPath: `url(#${clipId})` }}>
      <div ref={contentRef} style={{ position: 'absolute', left: 0, top: 0, width: source.width,
        height: source.height, transformOrigin: '0 0' }}>{children}</div>
    </div>
  </div>, document.body);
}
