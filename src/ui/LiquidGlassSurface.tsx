import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import {
  buildLiquidGlassVectorMap,
  resolveLiquidGlassOptics,
  type LiquidGlassGeometry,
  type LiquidGlassOpticsOverrides,
  type LiquidGlassPresetName,
} from './liquidGlassLensOptics';
import './LiquidGlassSurface.css';

type LiquidGlassCssProperties = CSSProperties & {
  '--ui-liquid-glass-tint-rgb': string;
  '--ui-liquid-glass-tint-alpha': string;
  '--ui-liquid-glass-blur': string;
  '--ui-liquid-glass-saturation': string;
  '--ui-liquid-glass-brightness': string;
  '--ui-liquid-glass-bezel-opacity': string;
  '--ui-liquid-glass-border-opacity': string;
  '--ui-liquid-glass-shadow-opacity': string;
  '--ui-liquid-glass-filter': string;
};

export type LiquidGlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  variant?: LiquidGlassPresetName;
  optics?: LiquidGlassOpticsOverrides;
  radius?: number;
};

export function LiquidGlassSurface({
  variant = 'lens',
  optics: opticsOverrides,
  radius = 28,
  className = '',
  style,
  children,
  ...props
}: LiquidGlassSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-liquid-glass-surface-${reactId}`;
  const optics = useMemo(
    () => resolveLiquidGlassOptics(variant, opticsOverrides),
    [variant, opticsOverrides],
  );
  const [geometry, setGeometry] = useState<LiquidGlassGeometry>({
    width: 1,
    height: 1,
    radius,
  });
  const [vectorMapHref, setVectorMapHref] = useState('');

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setGeometry(current => {
        const next = {
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          radius,
        };
        if (
          Math.abs(current.width - next.width) < 0.5
          && Math.abs(current.height - next.height) < 0.5
          && current.radius === next.radius
        ) return current;
        return next;
      });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [radius]);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const canvas = workCanvasRef.current ?? element.ownerDocument.createElement('canvas');
    workCanvasRef.current = canvas;
    const ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1.5;
    const vectorMap = buildLiquidGlassVectorMap(canvas, geometry, optics, ratio);
    setVectorMapHref(vectorMap?.href ?? '');
  }, [
    geometry,
    optics.neutralEdge,
    optics.rimWidth,
    optics.rimStrength,
    optics.trenchWidth,
    optics.trenchStrength,
  ]);

  const filterPadding = optics.filterPaddingPercent;
  const opticalStyle: LiquidGlassCssProperties = {
    ...style,
    borderRadius: radius,
    '--ui-liquid-glass-tint-rgb': `${optics.tint.r} ${optics.tint.g} ${optics.tint.b}`,
    '--ui-liquid-glass-tint-alpha': String(optics.tint.a),
    '--ui-liquid-glass-blur': `${optics.blurPx}px`,
    '--ui-liquid-glass-saturation': String(optics.saturation),
    '--ui-liquid-glass-brightness': String(optics.brightness),
    '--ui-liquid-glass-bezel-opacity': String(optics.bezelOpacity),
    '--ui-liquid-glass-border-opacity': String(optics.borderOpacity),
    '--ui-liquid-glass-shadow-opacity': String(optics.shadowOpacity),
    '--ui-liquid-glass-filter': `url(#${filterId})`,
  };

  return (
    <div
      ref={rootRef}
      className={`ui-liquid-glass-surface ${className}`.trim()}
      style={opticalStyle}
      {...props}
    >
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        className="ui-liquid-glass-surface__filter"
      >
        <filter
          id={filterId}
          x={`${-filterPadding}%`}
          y={`${-filterPadding}%`}
          width={`${100 + filterPadding * 2}%`}
          height={`${100 + filterPadding * 2}%`}
          colorInterpolationFilters="sRGB"
        >
          <feImage
            x="0"
            y="0"
            width={geometry.width}
            height={geometry.height}
            preserveAspectRatio="none"
            href={vectorMapHref}
            result="vectorMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="vectorMap"
            scale={optics.refraction + optics.rgbSpread}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            result="redPass"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="vectorMap"
            scale={optics.refraction}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            result="greenPass"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="vectorMap"
            scale={Math.max(0, optics.refraction - optics.rgbSpread)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            result="bluePass"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
          />
          <feBlend in="redPass" in2="greenPass" mode="screen" result="rg" />
          <feBlend in="rg" in2="bluePass" mode="screen" />
        </filter>
      </svg>
      <div className="ui-liquid-glass-surface__content">{children}</div>
    </div>
  );
}
