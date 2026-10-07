import { useRef, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GlassSurface } from '../GlassSurface';
import { resolveGlassMaterial, type GlassMaterialOverrides, type GlassPresetName } from '../glassMaterial';
import './top-panel.css';

const DEFAULT_BLUR_PX = 3;
const SWIPE_UP_THRESHOLD_PX = 56;
const SWIPE_AXIS_RATIO = 1.15;

type TopPanelCssProperties = CSSProperties & {
  '--ui-mezfit-top-panel-blur': string;
};

export type MezfitTopPanelProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onPointerDownCapture' | 'onPointerUpCapture' | 'onPointerCancelCapture'> & {
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
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const hasMaterial = materialPreset !== undefined || material !== undefined;
  const materialBlur = hasMaterial
    ? resolveGlassMaterial(materialPreset ?? 'modalTuned', material).blur
    : undefined;
  const frameStyle = {
    ...style,
    '--ui-mezfit-top-panel-blur': `${blur}px`,
  } as TopPanelCssProperties;

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!opened || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const onPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gestureRef.current;
    gestureRef.current = null;
    if (!opened || !start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (
      deltaY <= -SWIPE_UP_THRESHOLD_PX
      && Math.abs(deltaY) >= Math.abs(deltaX) * SWIPE_AXIS_RATIO
    ) {
      onClose();
    }
  };

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
      aria-hidden={opened ? undefined : true}
      style={frameStyle}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={() => {
        gestureRef.current = null;
      }}
    >
      {surface}
    </div>
  );
}
