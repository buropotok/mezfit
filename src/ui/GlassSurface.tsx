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
  LIQUID_CONVEX_LIGHTING,
  resolveGlassFilterRegion,
  resolveGlassMaterial,
  resolveGlassRadius,
  type GlassGeometry,
  type GlassMaterialOverrides,
  type GlassPresetName,
  type GlassShape,
} from './glassMaterial';
import './GlassSurface.css';

export type GlassBezelHighlights = {
  topLeft?: number;
  bottomRight?: number;
  /** Primary directional lobe for presets that provide contour-distributed bezel lighting. */
  primary?: number;
  /** Lobe opposite the primary directional highlight. */
  opposite?: number;
};

type GlassCssProperties = CSSProperties & {
  '--ui-glass-surface-tint-r': string;
  '--ui-glass-surface-tint-g': string;
  '--ui-glass-surface-tint-b': string;
  '--ui-glass-surface-tint-a': string;
  '--ui-glass-surface-blur': string;
  '--ui-glass-surface-saturation': string;
  '--ui-glass-surface-brightness': string;
  '--ui-glass-surface-bezel': string;
  '--ui-glass-surface-bezel-top-left': string;
  '--ui-glass-surface-bezel-bottom-right': string;
  '--ui-glass-surface-border': string;
  '--ui-glass-surface-shadow': string;
  '--ui-glass-surface-filter': string;
  '--ui-glass-surface-radius': string;
  '--ui-glass-surface-edge-outset': string;
  '--ui-glass-surface-edge-light-blur': string;
  '--ui-glass-surface-edge-dark-blur': string;
  '--ui-glass-surface-edge-light-x': string;
  '--ui-glass-surface-edge-light-y': string;
  '--ui-glass-surface-edge-dark-x': string;
  '--ui-glass-surface-edge-dark-y': string;
  '--ui-glass-surface-edge-light-base-alpha': string;
  '--ui-glass-surface-edge-light-dir-alpha': string;
  '--ui-glass-surface-edge-dark-alpha': string;
  '--ui-glass-surface-specular-angle': string;
  '--ui-glass-surface-specular-width': string;
  '--ui-glass-surface-specular-softness': string;
  '--ui-glass-surface-specular-primary-alpha': string;
  '--ui-glass-surface-specular-primary-side-alpha': string;
  '--ui-glass-surface-specular-opposite-alpha': string;
  '--ui-glass-surface-specular-opposite-side-alpha': string;
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
  /** Public backdrop blur override in CSS pixels. Legacy glass.blur remains supported and takes precedence. */
  blur?: number;
  glass?: GlassMaterialOverrides;
  shape?: GlassShape;
  contentClassName?: string;
  /** Implicit CSS-pixel silhouette; material, shadow and bezel follow this path. */
  contour?: string;
  /** Master visibility for bezel highlights only; the material border remains visible. */
  bezelOpacity?: number;
  /**
   * Independent bezel multipliers. Existing topLeft/bottomRight controls remain compatible.
   * Directional presets also accept primary/opposite aliases for their paired contour lobes.
   */
  bezelHighlights?: GlassBezelHighlights;
  wrapContent?: boolean;
  active?: boolean;
  optics?: boolean;
  children?: ReactNode;
};

export function GlassSurface({
  component = 'div',
  ref,
  preset = 'modalTuned',
  blur,
  glass,
  shape = 'auto',
  className = '',
  contentClassName = '',
  contour,
  bezelOpacity = 1,
  bezelHighlights,
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
  const material = useMemo(
    () => resolveGlassMaterial(preset, { ...glass, blur: glass?.blur ?? blur }),
    [preset, glass, blur],
  );
  const highlightOpacity = Math.max(0, Math.min(1, bezelOpacity));
  const topLeftHighlightOpacity = Math.max(0, Math.min(1, bezelHighlights?.topLeft ?? 1));
  const bottomRightHighlightOpacity = Math.max(0, Math.min(1, bezelHighlights?.bottomRight ?? 1));
  const primaryHighlightOpacity = Math.max(
    0,
    Math.min(1, bezelHighlights?.primary ?? bezelHighlights?.topLeft ?? 1),
  );
  const oppositeHighlightOpacity = Math.max(
    0,
    Math.min(1, bezelHighlights?.opposite ?? bezelHighlights?.bottomRight ?? 1),
  );
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
  const isLiquidConvex = preset === 'liquidConvex';
  const isCapsule = shape === 'capsule' || (
    geometry !== null
    && Math.abs(radius - Math.min(geometry.width, geometry.height) / 2) < 0.1
  );
  const liquidConvexScale = geometry
    ? Math.max(0.34, Math.min(1.26, geometry.height / 150))
    : 1;
  const liquidConvexEdgeWidth = LIQUID_CONVEX_LIGHTING.edgeWidth * liquidConvexScale;
  const liquidConvexEdgeOutset = LIQUID_CONVEX_LIGHTING.edgeOutset * liquidConvexScale;
  const liquidConvexLightAngle = isCapsule
    ? LIQUID_CONVEX_LIGHTING.capsuleLightAngle
    : LIQUID_CONVEX_LIGHTING.rectangleLightAngle;
  const liquidConvexBezelAngle = isCapsule
    ? LIQUID_CONVEX_LIGHTING.capsuleBezelAngle
    : LIQUID_CONVEX_LIGHTING.rectangleBezelAngle;
  const liquidConvexLightRadians = liquidConvexLightAngle * Math.PI / 180;
  const liquidConvexDirectionalOffset = liquidConvexEdgeWidth
    * 0.28
    * LIQUID_CONVEX_LIGHTING.directionality;
  const liquidConvexLightX = Math.cos(liquidConvexLightRadians) * liquidConvexDirectionalOffset;
  const liquidConvexLightY = Math.sin(liquidConvexLightRadians) * liquidConvexDirectionalOffset;
  const liquidConvexDarkX = -liquidConvexLightX * 0.78;
  const liquidConvexDarkY = -liquidConvexLightY * 0.78;
  const liquidConvexBaseLightAlpha = LIQUID_CONVEX_LIGHTING.edgeLight
    * (0.12 + (1 - LIQUID_CONVEX_LIGHTING.directionality) * 0.28);
  const liquidConvexDirectionalLightAlpha = LIQUID_CONVEX_LIGHTING.edgeLight
    * (0.16 + 0.54 * LIQUID_CONVEX_LIGHTING.directionality);
  const liquidConvexDarkAlpha = LIQUID_CONVEX_LIGHTING.edgeDark
    * (0.42 + 0.68 * LIQUID_CONVEX_LIGHTING.directionality);
  const liquidConvexSpecularAlpha = material.bezel
    * highlightOpacity
    * (0.12 + 0.36 * LIQUID_CONVEX_LIGHTING.directionality);
  const liquidConvexPrimaryAlpha = liquidConvexSpecularAlpha * primaryHighlightOpacity;
  const liquidConvexOppositeAlpha = liquidConvexSpecularAlpha * oppositeHighlightOpacity;
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
    '--ui-glass-surface-bezel': String(material.bezel * highlightOpacity),
    '--ui-glass-surface-bezel-top-left': String(material.bezel * highlightOpacity * topLeftHighlightOpacity),
    '--ui-glass-surface-bezel-bottom-right': String(material.bezel * highlightOpacity * bottomRightHighlightOpacity),
    '--ui-glass-surface-border': String(material.border),
    '--ui-glass-surface-shadow': String(material.shadow),
    '--ui-glass-surface-filter': `url(#${filterId})`,
    '--ui-glass-surface-radius': `${radius}px`,
    '--ui-glass-surface-edge-outset': `${liquidConvexEdgeOutset}px`,
    '--ui-glass-surface-edge-light-blur': `${liquidConvexEdgeWidth * 0.92}px`,
    '--ui-glass-surface-edge-dark-blur': `${liquidConvexEdgeWidth * 2.25}px`,
    '--ui-glass-surface-edge-light-x': `${liquidConvexLightX}px`,
    '--ui-glass-surface-edge-light-y': `${liquidConvexLightY}px`,
    '--ui-glass-surface-edge-dark-x': `${liquidConvexDarkX}px`,
    '--ui-glass-surface-edge-dark-y': `${liquidConvexDarkY}px`,
    '--ui-glass-surface-edge-light-base-alpha': String(liquidConvexBaseLightAlpha),
    '--ui-glass-surface-edge-light-dir-alpha': String(liquidConvexDirectionalLightAlpha),
    '--ui-glass-surface-edge-dark-alpha': String(liquidConvexDarkAlpha),
    '--ui-glass-surface-specular-angle': `${liquidConvexBezelAngle}deg`,
    '--ui-glass-surface-specular-width': `${LIQUID_CONVEX_LIGHTING.bezelWidth}px`,
    '--ui-glass-surface-specular-softness': `${LIQUID_CONVEX_LIGHTING.bezelSoftness}px`,
    '--ui-glass-surface-specular-primary-alpha': String(liquidConvexPrimaryAlpha),
    '--ui-glass-surface-specular-primary-side-alpha': String(liquidConvexPrimaryAlpha * 0.28),
    '--ui-glass-surface-specular-opposite-alpha': String(liquidConvexOppositeAlpha),
    '--ui-glass-surface-specular-opposite-side-alpha': String(liquidConvexOppositeAlpha * 0.28),
  };

  return (
    <Component
      {...props}
      ref={setRootRef}
      className={`ui-glass-surface ui-glass-surface--${wrapContent ? 'standalone' : 'host'}${contour ? ' ui-glass-surface--contour' : ''}${isLiquidConvex ? ' ui-glass-surface--liquid-convex' : ''} ${className}`.trim()}
      data-ui-glass-map-ready={activeVectorMapHref ? 'true' : 'false'}
      style={glassStyle}
    >
      {contour ? <>
        <svg className="ui-glass-surface__contour" aria-hidden="true">
          <defs>
            <clipPath id={`${filterId}-clip`} clipPathUnits="userSpaceOnUse"><path d={contour} /></clipPath>
            <filter id={`${filterId}-shadow`} x="-100%" y="-200%" width="300%" height="500%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="21" result="blurred" />
              <feOffset in="blurred" dy="14" result="shadow" />
              <feComposite in="shadow" in2="SourceAlpha" operator="out" />
            </filter>
            <linearGradient id={`${filterId}-bezel`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="white" stopOpacity="0.8" />
              <stop offset="0.5" stopColor="white" stopOpacity="0.08" />
              <stop offset="1" stopColor="white" stopOpacity="0.18" />
            </linearGradient>
          </defs>
          <path d={contour} fill="black" opacity={material.shadow} filter={`url(#${filterId}-shadow)`} />
        </svg>
        <div className="ui-glass-surface__contour-material" style={{ clipPath: `url(#${filterId}-clip)` }} />
        <svg className="ui-glass-surface__contour ui-glass-surface__contour-edge" aria-hidden="true">
          <path d={contour} fill="none" stroke="white" strokeOpacity={material.border} strokeWidth="1" />
          <path d={contour} fill="none" stroke={`url(#${filterId}-bezel)`} strokeOpacity={material.bezel * highlightOpacity} strokeWidth="0.5" />
        </svg>
      </> : null}
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

export type GlassBezelHighlight = { x: number; y: number; radius: number; opacity: number };

/** Material-owned highlights on an arbitrary contour, without a second material or border. */
export function GlassContourBezel({ contour, highlights, preset = 'modalTuned', opacity = 1 }: {
  contour: string;
  highlights: readonly GlassBezelHighlight[];
  preset?: GlassPresetName;
  opacity?: number;
}) {
  const id = `ui-glass-bezel-${useId().replace(/:/g, '')}`;
  const material = useMemo(() => resolveGlassMaterial(preset), [preset]);
  return (
    <svg className="ui-glass-surface__contour ui-glass-surface__contour-edge" aria-hidden="true"
      opacity={material.bezel * Math.max(0, Math.min(1, opacity))}>
      <defs>
        <clipPath id={`${id}-clip`} clipPathUnits="userSpaceOnUse"><path d={contour} /></clipPath>
        {highlights.map((highlight, index) => <radialGradient key={index} id={`${id}-${index}`} gradientUnits="userSpaceOnUse"
          cx={highlight.x} cy={highlight.y} r={highlight.radius}>
          <stop offset="0" stopColor="white" stopOpacity={highlight.opacity} />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>)}
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        {highlights.map((_, index) => <path key={index} d={contour} fill="none"
          stroke={`url(#${id}-${index})`} strokeWidth="2" />)}
      </g>
    </svg>
  );
}
