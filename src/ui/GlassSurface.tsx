import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import {
  buildGlassVectorMap,
  resolveGlassMaterial,
  resolveGlassRadius,
  type GlassGeometry,
  type GlassMaterialOverrides,
  type GlassShape,
} from './glassMaterial';
import './GlassSurface.css';

type GlassCssProperties = CSSProperties & {
  '--ui-glass-tint-r': string;
  '--ui-glass-tint-g': string;
  '--ui-glass-tint-b': string;
  '--ui-glass-tint-a': string;
  '--ui-glass-blur': string;
  '--ui-glass-saturation': string;
  '--ui-glass-brightness': string;
  '--ui-glass-bezel': string;
  '--ui-glass-border': string;
  '--ui-glass-shadow': string;
  '--ui-glass-thickness': string;
  '--ui-glass-caustic': string;
  '--ui-glass-depth-shadow': string;
  '--ui-glass-top-glint': string;
  '--ui-glass-filter': string;
};

export type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  glass?: GlassMaterialOverrides;
  shape?: GlassShape;
  contentClassName?: string;
};

export function GlassSurface({
  glass,
  shape = 'auto',
  className = '',
  contentClassName = '',
  style,
  children,
  ...props
}: GlassSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-glass-surface-${reactId}`;
  const material = useMemo(() => resolveGlassMaterial(glass), [glass]);
  const shapeRadius = typeof shape === 'object' ? shape.radius : shape;
  const [geometry, setGeometry] = useState<GlassGeometry | null>(null);
  const [vectorMapHref, setVectorMapHref] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const radius = resolveGlassRadius(width, height, shape);

      setGeometry(current => {
        if (
          current
          && Math.abs(current.width - width) < 0.5
          && Math.abs(current.height - height) < 0.5
          && Math.abs(current.radius - radius) < 0.1
        ) return current;

        return { width, height, radius };
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shapeRadius]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || !geometry) return undefined;

    const view = element.ownerDocument.defaultView;
    let cancelled = false;

    const build = () => {
      if (cancelled) return;

      const currentElement = rootRef.current;
      if (!currentElement) return;

      const canvas = workCanvasRef.current ?? currentElement.ownerDocument.createElement('canvas');
      workCanvasRef.current = canvas;
      const ratio = currentElement.ownerDocument.defaultView?.devicePixelRatio ?? 1.5;
      const map = buildGlassVectorMap(canvas, geometry, material, ratio);
      if (!cancelled) setVectorMapHref(map?.href ?? null);
    };

    if (!view || typeof view.requestAnimationFrame !== 'function') {
      build();
      return () => {
        cancelled = true;
      };
    }

    const frame = view.requestAnimationFrame(build);
    return () => {
      cancelled = true;
      view.cancelAnimationFrame(frame);
    };
  }, [
    geometry,
    material.neutralEdge,
    material.rimWidth,
    material.rimStrength,
    material.trenchWidth,
    material.trenchStrength,
    material.depthWidth,
    material.depthRefraction,
  ]);

  const radius = geometry?.radius ?? 0;
  const filterPadding = material.filterPadding;
  const glassStyle: GlassCssProperties = {
    ...style,
    borderRadius: radius || undefined,
    '--ui-glass-tint-r': String(material.tintR),
    '--ui-glass-tint-g': String(material.tintG),
    '--ui-glass-tint-b': String(material.tintB),
    '--ui-glass-tint-a': String(material.tintA),
    '--ui-glass-blur': `${material.blur}px`,
    '--ui-glass-saturation': String(material.saturation),
    '--ui-glass-brightness': String(material.brightness),
    '--ui-glass-bezel': String(material.bezel),
    '--ui-glass-border': String(material.border),
    '--ui-glass-shadow': String(material.shadow),
    '--ui-glass-thickness': String(material.thickness),
    '--ui-glass-caustic': String(material.caustic),
    '--ui-glass-depth-shadow': String(material.depthShadow),
    '--ui-glass-top-glint': String(material.topGlint),
    '--ui-glass-filter': `url(#${filterId})`,
  };

  return (
    <div
      ref={rootRef}
      className={`ui-glass-surface ${className}`.trim()}
      data-ui-glass-map-ready={vectorMapHref ? 'true' : 'false'}
      style={glassStyle}
      {...props}
    >
      {vectorMapHref && geometry ? (
        <svg
          width="0"
          height="0"
          aria-hidden="true"
          className="ui-glass-surface__filter"
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
              scale={material.refraction + material.rgbSpread}
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
              scale={material.refraction}
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
              scale={Math.max(0, material.refraction - material.rgbSpread)}
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
      ) : null}
      <div className="ui-glass-surface__top-glint" aria-hidden="true" />
      <div className={`ui-glass-surface__content ${contentClassName}`.trim()}>{children}</div>
    </div>
  );
}
