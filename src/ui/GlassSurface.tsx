import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import {
  buildGlassVectorMap,
  resolveGlassFilterRegion,
  resolveGlassMaterial,
  resolveGlassRadius,
  type GlassGeometry,
  type GlassMaterialOverrides,
  type GlassPresetName,
  type GlassShape,
} from './glassMaterial';
import './GlassSurface.css';

type GlassCssProperties = CSSProperties & {
  '--ui-glass-surface-tint-r': string;
  '--ui-glass-surface-tint-g': string;
  '--ui-glass-surface-tint-b': string;
  '--ui-glass-surface-tint-a': string;
  '--ui-glass-surface-blur': string;
  '--ui-glass-surface-saturation': string;
  '--ui-glass-surface-brightness': string;
  '--ui-glass-surface-bezel': string;
  '--ui-glass-surface-border': string;
  '--ui-glass-surface-shadow': string;
  '--ui-glass-surface-filter': string;
};

const GLASS_VECTOR_MAP_CACHE_LIMIT = 4;
const glassVectorMapCache = new Map<string, string>();

function readCachedVectorMap(key: string) {
  const href = glassVectorMapCache.get(key);
  if (!href) return null;

  glassVectorMapCache.delete(key);
  glassVectorMapCache.set(key, href);
  return href;
}

function cacheVectorMap(key: string, href: string) {
  glassVectorMapCache.delete(key);
  glassVectorMapCache.set(key, href);

  while (glassVectorMapCache.size > GLASS_VECTOR_MAP_CACHE_LIMIT) {
    const oldestKey = glassVectorMapCache.keys().next().value;
    if (oldestKey === undefined) break;
    glassVectorMapCache.delete(oldestKey);
  }
}

function vectorMapCacheKey(
  geometry: GlassGeometry,
  material: ReturnType<typeof resolveGlassMaterial>,
  pixelRatio: number,
) {
  const sampleScale = Math.max(1.25, Math.min(2, pixelRatio || 1.5));
  return [
    geometry.width.toFixed(1),
    geometry.height.toFixed(1),
    geometry.radius.toFixed(1),
    material.neutralEdge,
    material.rimWidth,
    material.rimStrength,
    material.trenchWidth,
    material.trenchStrength,
    sampleScale.toFixed(2),
  ].join(':');
}

export type GlassSurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  component?: ElementType;
  ref?: Ref<HTMLElement>;
  preset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  shape?: GlassShape;
  contentClassName?: string;
  wrapContent?: boolean;
  active?: boolean;
  optics?: boolean;
  children?: ReactNode;
};

export function GlassSurface({
  component = 'div',
  ref,
  preset = 'modalTuned',
  glass,
  shape = 'auto',
  className = '',
  contentClassName = '',
  wrapContent = true,
  active = true,
  optics = false,
  style,
  children,
  ...props
}: GlassSurfaceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-glass-surface-${reactId}`;
  const material = useMemo(() => resolveGlassMaterial(preset, glass), [preset, glass]);
  const hostMode = !wrapContent;
  const shapeRadius = typeof shape === 'object' ? shape.radius : shape;
  const [geometry, setGeometry] = useState<GlassGeometry | null>(null);
  const [vectorMapHref, setVectorMapHref] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!active) return undefined;

    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, element.offsetWidth || rect.width);
      const height = Math.max(1, element.offsetHeight || rect.height);
      const preserveHostRadius = hostMode && shape === 'auto';
      const computedRadius = preserveHostRadius
        ? Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).borderTopLeftRadius ?? '')
        : Number.NaN;
      const radius = Number.isFinite(computedRadius)
        ? Math.min(computedRadius, Math.min(width, height) / 2)
        : resolveGlassRadius(width, height, shape);

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
  }, [active, hostMode, shapeRadius]);

  useEffect(() => {
    if (!optics) {
      setVectorMapHref(null);
      return undefined;
    }
    if (!active) return undefined;

    const element = rootRef.current;
    if (!element || !geometry) return undefined;

    const view = element.ownerDocument.defaultView;
    const ratio = view?.devicePixelRatio ?? 1.5;
    const cacheKey = vectorMapCacheKey(geometry, material, ratio);
    const cachedMap = readCachedVectorMap(cacheKey);
    if (cachedMap) {
      setVectorMapHref(cachedMap);
      return undefined;
    }

    let cancelled = false;

    const build = () => {
      if (cancelled) return;

      const currentElement = rootRef.current;
      if (!currentElement) return;

      const canvas = workCanvasRef.current ?? currentElement.ownerDocument.createElement('canvas');
      workCanvasRef.current = canvas;
      const map = buildGlassVectorMap(canvas, geometry, material, ratio);
      if (!cancelled) {
        if (map) cacheVectorMap(cacheKey, map.href);
        setVectorMapHref(map?.href ?? null);
      }
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
    active,
    optics,
    geometry,
    material.neutralEdge,
    material.rimWidth,
    material.rimStrength,
    material.trenchWidth,
    material.trenchStrength,
  ]);

  const Component = component;
  const setRootRef = (element: HTMLElement | null) => {
    rootRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  const radius = geometry?.radius ?? 0;
  const activeVectorMapHref = optics ? vectorMapHref : null;
  const filterRegion = activeVectorMapHref && geometry
    ? resolveGlassFilterRegion(geometry, material)
    : null;
  const glassStyle: GlassCssProperties = {
    ...style,
    ...(hostMode && shape === 'auto' ? {} : { borderRadius: radius || undefined }),
    '--ui-glass-surface-tint-r': String(material.tintR),
    '--ui-glass-surface-tint-g': String(material.tintG),
    '--ui-glass-surface-tint-b': String(material.tintB),
    '--ui-glass-surface-tint-a': String(material.tintA),
    '--ui-glass-surface-blur': `${material.blur}px`,
    '--ui-glass-surface-saturation': String(material.saturation),
    '--ui-glass-surface-brightness': String(material.brightness),
    '--ui-glass-surface-bezel': String(material.bezel),
    '--ui-glass-surface-border': String(material.border),
    '--ui-glass-surface-shadow': String(material.shadow),
    '--ui-glass-surface-filter': `url(#${filterId})`,
  };

  return (
    <Component
      {...props}
      ref={setRootRef}
      className={`ui-glass-surface ui-glass-surface--${wrapContent ? 'standalone' : 'host'} ${className}`.trim()}
      data-ui-glass-map-ready={activeVectorMapHref ? 'true' : 'false'}
      style={glassStyle}
    >
      {activeVectorMapHref && geometry && filterRegion ? (
        <svg
          width="0"
          height="0"
          aria-hidden="true"
          className="ui-glass-surface__filter"
        >
          <filter
            id={filterId}
            x={`${-filterRegion.paddingX}%`}
            y={`${-filterRegion.paddingY}%`}
            width={`${100 + filterRegion.paddingX * 2}%`}
            height={`${100 + filterRegion.paddingY * 2}%`}
            colorInterpolationFilters="sRGB"
          >
            <feImage
              x="0"
              y="0"
              width={geometry.width}
              height={geometry.height}
              preserveAspectRatio="none"
              href={activeVectorMapHref}
              result="vectorMap"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="vectorMap"
              scale={material.refraction}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>
      ) : null}
      {wrapContent ? (
        <div className={`ui-glass-surface__content ${contentClassName}`.trim()}>{children}</div>
      ) : children}
    </Component>
  );
}
