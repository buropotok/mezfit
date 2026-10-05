import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { GlassSurface } from './GlassSurface';
import { Icon, type UiIconName } from './Icon';
import { Text } from './primitives';
import type { GlassPresetName } from './glassMaterial';
import { startPressScale } from './PressScale';
import { FAB_METABALL, FAB_METABALL_STAGE_WIDTH, fabContour, fabFrame, fabGeometry, fabRupture, smoothFab } from './fabMetaballGeometry';
import './MetaballFab.css';

export type FloatingActionButtonAction = { label: string; onClick: () => void; disabled?: boolean; icon?: UiIconName };
export type MetaballFabProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string; isShown: boolean; placement: 'left' | 'right';
  glassPreset?: GlassPresetName; glassOptics?: boolean; icon?: UiIconName; children?: ReactNode;
  /** Moving left action first, stationary right action second. */
  actions: readonly [FloatingActionButtonAction, FloatingActionButtonAction];
};

export function MetaballFab({ label, isShown, placement, glassPreset, glassOptics, icon, children, actions, className = '', style, disabled, onClick, onPointerDown, onKeyDown, type = 'button', ...props }: MetaballFabProps) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const progress = useRef(0);
  const selectionLocked = useRef(false);
  const wasMoving = useRef(false);
  const [time, setTime] = useState(0);
  const [open, setOpen] = useState(false);
  const [bezelReveal, setBezelReveal] = useState(1);
  const [layout, setLayout] = useState({ width: FAB_METABALL_STAGE_WIDTH, sourceSize: 56 });
  const id = `fab-metaball-${useId().replace(/:/g, '')}`;
  const rupture = useMemo(() => fabRupture(layout), [layout]);
  const geometry = useMemo(() => fabFrame(time, layout, rupture), [time, layout, rupture]);
  const contour = useMemo(() => isShown ? fabContour(geometry) : '', [geometry, isShown]);
  const final = useMemo(() => fabGeometry(1, layout), [layout]);
  const expanded = time > 0;
  const settled = time === 1;

  useLayoutEffect(() => {
    if (!isShown) return;
    const element = root.current; if (!element) return;
    const measure = () => {
      const width = element.offsetWidth || FAB_METABALL_STAGE_WIDTH, sourceSize = element.offsetHeight || 56;
      setLayout(current => current.width === width && current.sourceSize === sourceSize ? current : { width, sourceSize });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [isShown]);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    const target = open && isShown && !disabled ? 1 : 0;
    const from = progress.current;
    if (from === target) return;
    const view = root.current?.ownerDocument.defaultView;
    if (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !isShown) {
      progress.current = target; setTime(target); return;
    }
    const duration = FAB_METABALL.duration * Math.abs(target - from);
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const fraction = Math.min(1, (now - start) / duration);
      const value = from + (target - from) * fraction;
      progress.current = value; setTime(value);
      if (fraction < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [open, isShown, disabled]);

  const moving = expanded && !settled;
  useLayoutEffect(() => {
    const revealAfterMotion = wasMoving.current;
    wasMoving.current = moving;
    if (!isShown) { setBezelReveal(1); return; }
    if (!moving && !revealAfterMotion) return;
    if (moving) { setBezelReveal(0); return; }
    const view = root.current?.ownerDocument.defaultView;
    if (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setBezelReveal(1); return;
    }
    let revealFrame = 0, start: number | undefined;
    const reveal = (now: number) => {
      start ??= now;
      const value = Math.min(1, (now - start) / 120);
      setBezelReveal(smoothFab(value));
      if (value < 1) revealFrame = requestAnimationFrame(reveal);
    };
    setBezelReveal(0);
    revealFrame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(revealFrame);
  }, [moving, isShown]);

  useEffect(() => { if (!isShown || disabled) setOpen(false); }, [isShown, disabled]);
  useEffect(() => {
    if (!open || !isShown || disabled) return;
    const document = root.current?.ownerDocument; if (!document) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, isShown, disabled]);

  const hitbox = (x: number, width: number, height: number): CSSProperties => ({ left: (placement === 'left' ? layout.width - x : x) - width / 2, top: (layout.sourceSize - height) / 2, width, height });
  const artwork = icon ? <Icon name={icon} variant="outline" style={{ width: 36, height: 36, flexShrink: 0, pointerEvents: 'none' }} /> : children;
  const dayLabelX = geometry.base.x + (final.day.x - geometry.base.x) * smoothFab(time / rupture);
  const revealBlur = 3 * (1 - smoothFab((time - 0.35) / 0.3));

  return (
    <div ref={root} className={`ui-fab ui-fab--${placement}${isShown ? ' ui-fab--shown' : ' ui-fab--hidden'} ui-text--body ui-fab-metaball ui-fab-metaball--${placement} ${className}`.trim()} style={{ ...style, '--ui-fab-metaball-width': `${FAB_METABALL_STAGE_WIDTH}px` } as CSSProperties} aria-hidden={!isShown || undefined} data-ui-fab-mode="metaball" data-disabled={disabled || undefined}>
      {!expanded ? <GlassSurface className="ui-fab-metaball__source" contentClassName="ui-fab-metaball__source-content" preset={glassPreset} optics={glassOptics} active={isShown} bezelOpacity={bezelReveal} shape="capsule">{artwork}</GlassSurface> : null}
      {expanded && !settled ? <GlassSurface className="ui-fab-metaball__liquid" preset={glassPreset} active={isShown} bezelOpacity={0} contour={contour} shape={{ radius: 0 }} /> : null}
      {settled ? [final.day, final.phase].map((shape, index) => <GlassSurface key={index} className="ui-fab-metaball__capsule" preset={glassPreset} optics={glassOptics} active={isShown} bezelOpacity={bezelReveal} shape="capsule" style={hitbox(shape.x, shape.width, 44)} />) : null}
      {expanded ? <div className="ui-fab-metaball__labels" style={{ clipPath: `path('${contour}')` }} aria-hidden="true">
        {time > 0.35 ? <div style={{ filter: `blur(${revealBlur}px)` }}>
          {actions.map((action, index) => { const actionIcon = action.icon ?? icon; return <span key={index} className="ui-fab-metaball__label" data-disabled={action.disabled || undefined} style={{ left: index ? final.phase.x : dayLabelX, top: geometry.base.y }}>
            {actionIcon ? <Icon name={actionIcon} variant="outline" style={{ width: 36, height: 36, flexShrink: 0 }} /> : artwork}
            <Text variant="headline">{action.label}</Text>
          </span>; })}
        </div> : null}
        {time < 0.4 ? <span className="ui-fab-metaball__artwork" style={{ left: geometry.base.x, top: geometry.base.y, opacity: 1 - smoothFab(time / 0.4) }}>{artwork}</span> : null}
      </div> : null}
      <button {...props} type={type} className="ui-fab-metaball__hitbox" style={hitbox(geometry.base.x, layout.sourceSize, layout.sourceSize)} aria-label={label} aria-expanded={open} aria-controls={`${id}-actions`} disabled={disabled || !isShown || expanded} tabIndex={isShown && !expanded ? props.tabIndex ?? 0 : -1}
        onClick={event => { onClick?.(event); if (!event.defaultPrevented) { selectionLocked.current = false; setOpen(true); } }}
        onPointerDown={event => { onPointerDown?.(event); if (!event.defaultPrevented) startPressScale(event.currentTarget); }} onKeyDown={onKeyDown} />
      <div id={`${id}-actions`} role="group" aria-label={label} hidden={!expanded}>
        {actions.map((action, index) => <button key={index} type="button" className="ui-fab-metaball__hitbox" aria-label={action.label} style={hitbox(index ? final.phase.x : final.day.x, index ? final.phase.width : final.day.width, 44)} disabled={disabled || action.disabled || !isShown || !open || !settled} tabIndex={isShown && open && settled ? 0 : -1}
          onPointerDown={event => startPressScale(event.currentTarget)} onClick={() => {
            if (selectionLocked.current || disabled || action.disabled || !isShown || !open || !settled) return;
            selectionLocked.current = true;
            setOpen(false);
            action.onClick();
          }} />)}
      </div>
    </div>
  );
}
