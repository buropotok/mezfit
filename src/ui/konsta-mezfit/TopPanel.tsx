import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GlassSurface } from '../GlassSurface';
import { resolveGlassMaterial, type GlassMaterialOverrides, type GlassPresetName } from '../glassMaterial';
import './top-panel.css';

const DEFAULT_BLUR_PX = 3;
const SWIPE_UP_THRESHOLD_PX = 56;
const SWIPE_AXIS_RATIO = 1.15;

type TopPanelCssProperties = CSSProperties & {
  '--ui-mezfit-top-panel-blur': string;
};

export type MezfitTopPanelProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  | 'children'
  | 'onPointerDownCapture'
  | 'onPointerMoveCapture'
  | 'onPointerUpCapture'
  | 'onPointerCancelCapture'
  | 'onLostPointerCapture'
> & {
  opened: boolean;
  onClose: () => void;
  blur?: number;
  materialPreset?: GlassPresetName;
  material?: GlassMaterialOverrides;
  materialOptics?: boolean;
  children?: ReactNode;
};

export function MezfitTopPanel({
  opened,
  onClose,
  blur = DEFAULT_BLUR_PX,
  materialPreset,
  material,
  materialOptics = false,
  className = '',
  style,
  children,
  ...props
}: MezfitTopPanelProps) {
  const gestureRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    captureTarget: Element;
  } | null>(null);
  const hasMaterial = materialPreset !== undefined || material !== undefined;
  const materialBlur = hasMaterial
    ? resolveGlassMaterial(materialPreset ?? 'modalTuned', material).blur
    : undefined;
  const frameStyle = {
    ...style,
    '--ui-mezfit-top-panel-blur': `${blur}px`,
  } as TopPanelCssProperties;

  const releasePointerCapture = (element: Element, pointerId: number) => {
    if (typeof element.releasePointerCapture !== 'function') return;
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture is an enhancement. Gesture tracking still works without it.
    }
  };

  const finishGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    finishWithoutClose: boolean,
  ) => {
    const start = gestureRef.current;
    if (!opened || !start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const shouldClose = deltaY <= -SWIPE_UP_THRESHOLD_PX
      && Math.abs(deltaY) >= Math.abs(deltaX) * SWIPE_AXIS_RATIO;

    if (!shouldClose && !finishWithoutClose) return;

    gestureRef.current = null;
    releasePointerCapture(start.captureTarget, event.pointerId);
    if (shouldClose) onClose();
  };

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!opened || gestureRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const captureTarget = event.target instanceof Element ? event.target : event.currentTarget;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      captureTarget,
    };

    if (typeof captureTarget.setPointerCapture !== 'function') return;
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch {
      // Older WKWebView builds may reject capture; pointer-move detection remains the fallback.
    }
  };

  const onPointerMoveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishGesture(event, false);
  };

  const onPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishGesture(event, true);
  };

  const onPointerCancelCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gestureRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    releasePointerCapture(start.captureTarget, event.pointerId);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current = null;
  };

  useEffect(() => {
    if (opened) return;

    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture) releasePointerCapture(gesture.captureTarget, gesture.pointerId);
  }, [opened]);

  const surfaceClassName = [
    'ui-mezfit-top-panel__surface',
    hasMaterial ? 'ui-mezfit-top-panel__surface--material' : 'ui-mezfit-top-panel__surface--bare',
  ].join(' ');

  const surface = hasMaterial ? (
    <GlassSurface
      component="section"
      preset={materialPreset ?? 'modalTuned'}
      glass={material}
      blur={materialBlur}
      optics={materialOptics}
      wrapContent={false}
      shape="auto"
      className={surfaceClassName}
    >
      {children}
    </GlassSurface>
  ) : (
    <section className={surfaceClassName}>
      {children}
    </section>
  );

  return (
    <div
      {...props}
      className={`ui-mezfit-top-panel ${className}`.trim()}
      data-state={opened ? 'opened' : 'closed'}
      data-material={hasMaterial ? 'glass' : 'default'}
      inert={opened ? undefined : true}
      style={frameStyle}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={onPointerCancelCapture}
      onLostPointerCapture={onLostPointerCapture}
    >
      {surface}
    </div>
  );
}
