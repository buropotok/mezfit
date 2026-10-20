import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  text: string;
  children: ReactNode;
}

function hidden(key: string): boolean {
  try { return localStorage.getItem(key) === 'hidden'; } catch { return false; }
}

/** Measure only registered targets, clipping to their scroll containers and viewport. */
function visibleRect(node: HTMLElement): Rect | null {
  if (!node.isConnected || !node.getClientRects().length) return null;
  const rect = node.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent.hidden || parent.inert || style.visibility === 'hidden' || style.display === 'none') return null;
    if (parent === node) continue;
    const bounds = parent.getBoundingClientRect();
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
export function SpotlightHint({ hintId, version, userId, enabled, paused = false, text, children }: SpotlightHintProps) {
  const preferenceKey = 'mezfit:hint:' + encodeURIComponent(userId) + ':' + encodeURIComponent(hintId) + ':' + version;
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const [suppressedKey, setSuppressedKey] = useState<string | null>(null);
  const [targets, setTargets] = useState<HTMLDivElement[]>([]);
  const [rects, setRects] = useState<Rect[]>([]);
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
    if (!enabled) setClosedKey(null);
  }, [enabled]);

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setRects(targets.flatMap(node => {
        const rect = visibleRect(node);
        return rect ? [rect] : [];
      }));
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
    const intersection = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(invalidate, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    targets.forEach(node => { resize?.observe(node); intersection?.observe(node); });
    if (root.current) resize?.observe(root.current);
    window.addEventListener('scroll', invalidate, true);
    window.addEventListener('resize', invalidate);
    window.addEventListener('transitionend', invalidate, true);
    window.visualViewport?.addEventListener('resize', invalidate);
    window.visualViewport?.addEventListener('scroll', invalidate);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect(); intersection?.disconnect();
      window.removeEventListener('scroll', invalidate, true);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('transitionend', invalidate, true);
      window.visualViewport?.removeEventListener('resize', invalidate);
      window.visualViewport?.removeEventListener('scroll', invalidate);
    };
  }, [active, targets]);

  const neverShow = () => {
    try { localStorage.setItem(preferenceKey, 'hidden'); } catch { /* Private WebViews may deny storage. */ }
    setSuppressedKey(preferenceKey);
    finish();
  };
  return <TargetContext.Provider value={context}>
    <div ref={root} className="ui-spotlight-hint__scope">{children}</div>
    {active && rects.length > 0 ? createPortal(
      <aside className="ui-spotlight-hint" aria-label="Подсказка">
        <svg className="ui-spotlight-hint__mask" width="100%" height="100%" aria-hidden="true">
          <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect width="100%" height="100%" fill="white" />
            {rects.map((rect, index) => <rect key={index} x={rect.left} y={rect.top}
              width={rect.width} height={rect.height} rx={Math.min(22, rect.height / 2)} fill="black" />)}
          </mask></defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.78)" mask={'url(#' + maskId + ')'} />
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
