import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Text } from './primitives';
import './spotlight-hint.css';

type Rect = { left: number; top: number; width: number; height: number };
type Targets = { register: (node: HTMLDivElement) => () => void; finish: () => void; suspend: () => () => void };
const TargetContext = createContext<Targets | null>(null);

export interface SpotlightHintProps {
  hintId: string;
  version: number;
  /** Account identity; dismissal is local to this user and device. */
  userId: string;
  enabled: boolean;
  paused?: boolean;
  /** Whole scrolling content, including surrounding controls. Never the scroll viewport itself. */
  surfaceRef?: RefObject<HTMLDivElement | null>;
  /** Reveal the first available target once per entry, even when hints are dismissed. */
  autoScroll?: boolean;
  text: string;
  children: ReactNode;
}

function hidden(key: string): boolean {
  try { return localStorage.getItem(key) === 'hidden'; } catch { return false; }
}

function scrollContainer(surface: HTMLElement): HTMLElement | null {
  for (let parent = surface.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/** Local content coordinates do not change during compositor-driven scrolling. */
function targetRect(node: HTMLElement, surface: HTMLElement, origin: DOMRect): Rect | null {
  if (!node.isConnected || !surface.contains(node) || !node.getClientRects().length) return null;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent.hidden || parent.hasAttribute('inert') || style.visibility === 'hidden' || style.display === 'none') return null;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    ? { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }
    : null;
}

/** Only the non-scrolling viewport boundary belongs to the fixed outer shade. */
function surfaceViewport(surface: HTMLElement): Rect | null {
  const viewport = scrollContainer(surface);
  const rect = (viewport ?? surface).getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = viewport?.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** A non-modal guide: real controls remain interactive and scrolling stays native. */
export function SpotlightHint({ hintId, version, userId, enabled, paused = false, surfaceRef, autoScroll = false, text, children }: SpotlightHintProps) {
  const preferenceKey = 'mezfit:hint:' + encodeURIComponent(userId) + ':' + encodeURIComponent(hintId) + ':' + version;
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const [suppressedKey, setSuppressedKey] = useState<string | null>(null);
  const [targets, setTargets] = useState<HTMLDivElement[]>([]);
  const [geometry, setGeometry] = useState<{ surface: HTMLElement; rects: Rect[]; viewport: Rect } | null>(null);
  const scrolledEntry = useRef<string | null>(null);
  const [suspensions, setSuspensions] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const maskId = useId().replace(/:/g, '') + '-spotlight';
  const active = enabled && !paused && suspensions === 0 && closedKey !== preferenceKey && suppressedKey !== preferenceKey && !hidden(preferenceKey);
  const finish = useCallback(() => setClosedKey(preferenceKey), [preferenceKey]);
  const register = useCallback((node: HTMLDivElement) => {
    setTargets(current => [...current, node]);
    return () => setTargets(current => current.filter(target => target !== node));
  }, []);
  const suspend = useCallback(() => {
    setSuspensions(current => current + 1);
    return () => setSuspensions(current => current - 1);
  }, []);
  const context = useMemo(() => enabled ? { register, finish, suspend } : null, [enabled, register, finish, suspend]);

  useEffect(() => {
    // A temporary close lasts for this entry; permanent dismissal survives re-entry.
    if (!enabled) { setClosedKey(null); scrolledEntry.current = null; }
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled || paused || suspensions || !autoScroll || scrolledEntry.current === preferenceKey) return;
    const surface = surfaceRef?.current ?? root.current;
    if (!surface) return;
    const origin = surface.getBoundingClientRect();
    const node = targets.find(target => targetRect(target, surface, origin));
    if (!node) return;
    scrolledEntry.current = preferenceKey;
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const viewport = scrollContainer(surface);
    if (viewport) {
      const target = node.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      const top = Math.max(0, viewport.scrollTop + target.top - bounds.top
        - ((viewport.clientHeight || bounds.height) - target.height) / 2);
      if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top, behavior });
      else viewport.scrollTop = top;
    } else node.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior });
  }, [enabled, paused, suspensions, autoScroll, preferenceKey, surfaceRef, targets]);

  useLayoutEffect(() => {
    if (!active) return;
    const surface = surfaceRef?.current ?? root.current;
    if (!surface) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const origin = surface.getBoundingClientRect(), viewport = surfaceViewport(surface);
      const rects = targets.flatMap(node => {
        const rect = targetRect(node, surface, origin);
        return rect ? [rect] : [];
      });
      setGeometry(viewport && rects.length ? { surface, rects, viewport } : null);
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
    targets.forEach(node => resize?.observe(node));
    resize?.observe(surface);
    const viewport = scrollContainer(surface);
    if (viewport) resize?.observe(viewport);
    window.addEventListener('resize', invalidate);
    window.addEventListener('transitionend', invalidate, true);
    window.visualViewport?.addEventListener('resize', invalidate);
    surface.ownerDocument.fonts?.addEventListener('loadingdone', invalidate);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('transitionend', invalidate, true);
      window.visualViewport?.removeEventListener('resize', invalidate);
      surface.ownerDocument.fonts?.removeEventListener('loadingdone', invalidate);
    };
  }, [active, targets, surfaceRef]);

  const neverShow = () => {
    try { localStorage.setItem(preferenceKey, 'hidden'); } catch { /* Private WebViews may deny storage. */ }
    setSuppressedKey(preferenceKey);
    finish();
  };
  return <TargetContext.Provider value={context}>
    <div ref={root} className="ui-spotlight-hint__scope">{children}</div>
    {active && geometry ? createPortal(
      <svg className="ui-spotlight-hint__local-mask" width="100%" height="100%" aria-hidden="true">
        <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <rect width="100%" height="100%" fill="white" />
          {geometry.rects.map((rect, index) => <rect key={index} x={rect.left} y={rect.top}
            width={rect.width} height={rect.height} rx={Math.min(22, rect.height / 2)} fill="black" />)}
        </mask></defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.78)" mask={'url(#' + maskId + ')'} />
      </svg>, geometry.surface,
    ) : null}
    {active && geometry ? createPortal(
      <aside className="ui-spotlight-hint" aria-label="Подсказка">
        <svg className="ui-spotlight-hint__mask" width="100%" height="100%" aria-hidden="true">
          <defs><mask id={maskId + '-viewport'} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect width="100%" height="100%" fill="white" />
            <rect x={geometry.viewport.left} y={geometry.viewport.top}
              width={geometry.viewport.width} height={geometry.viewport.height} fill="black" />
          </mask></defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.78)" mask={'url(#' + maskId + '-viewport)'} />
        </svg>
        <div className="ui-spotlight-hint__copy">
          <div className="ui-spotlight-hint__controls">
            <button type="button" onClick={neverShow}><Text variant="body">Больше не показывать</Text></button>
            <button type="button" onClick={finish}><Text variant="body">Закрыть</Text></button>
          </div>
          <Text variant="body">{text}</Text>
        </div>
      </aside>, document.body,
    ) : null}
  </TargetContext.Provider>;
}

/** Explicit registration, without selectors, cloned buttons or program knowledge. */
export function SpotlightTarget({ children }: { children: ReactNode }) {
  const context = useContext(TargetContext);
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (context && node.current) return context.register(node.current);
  }, [context]);
  return context ? <div ref={node} className="ui-spotlight-hint__target" onClickCapture={context.finish}>
    {children}
  </div> : <>{children}</>;
}

/** Nested menus/sheets can pause the guide without changing its dismissal preference. */
export function useSpotlightHintPause(paused: boolean) {
  const context = useContext(TargetContext);
  useEffect(() => {
    if (paused && context) return context.suspend();
  }, [paused, context]);
}

/** The surface and its target holes share the browser's native scrolling plane. */
export function SpotlightSurface({ children, ref }: { children: ReactNode; ref?: RefObject<HTMLDivElement | null> }) {
  return <div ref={ref} className="ui-spotlight-hint__surface">{children}</div>;
}
