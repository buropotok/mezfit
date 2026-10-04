import {
  Fragment,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { GlassSurface } from './GlassSurface';
import { Menu, MenuDivider, MenuItem } from './Menu';
import { resolveGlassRadius, type GlassPresetName } from './glassMaterial';
import {
  clamp,
  contourBounds,
  paintLiquidMap,
  paintLiquidMesh,
  smooth,
  smoother,
} from './liquidPopoverCanvas';
import {
  createLiquidMotion,
  LIQUID_POPOVER_DEFAULTS,
  type LiquidMotionOptions,
  type LiquidRect,
} from './liquidPopoverGeometry';
import './liquid-popover.css';

export type LiquidPopoverItem = {
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  active?: boolean;
  dividerBefore?: boolean;
  'aria-checked'?: boolean;
  'aria-current'?: 'page';
};

export interface LiquidPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The existing Menu trigger; activation and application state stay with its owner. */
  trigger: ReactElement;
  /** The whole originating surface, e.g. Navbar's right capsule or a circular button. */
  triggerRef: RefObject<HTMLElement | null>;
  items: readonly LiquidPopoverItem[];
  label?: string;
  align?: 'start' | 'end';
  preset?: GlassPresetName;
  motion?: Partial<LiquidMotionOptions>;
}

export function resolveLiquidMotionOptions(
  overrides: Partial<LiquidMotionOptions> = {},
): LiquidMotionOptions {
  const bounds: Record<keyof LiquidMotionOptions, readonly [number, number]> = {
    duration: [0.1, 4],
    sourceMorph: [0.001, 1],
    tail: [0, 200],
    ovalArea: [0.1, 1.5],
    exponent: [2, 6],
    growthDelay: [0, 0.8],
    curvature: [0, 1],
    smoothing: [0, 5],
  };
  const result = { ...LIQUID_POPOVER_DEFAULTS };
  for (const key of Object.keys(bounds) as (keyof LiquidMotionOptions)[]) {
    const value = overrides[key];
    if (value !== undefined && Number.isFinite(value))
      result[key] = clamp(value, ...bounds[key]);
  }
  return result;
}

const toLiquidRect = (rect: DOMRect): LiquidRect => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
  w: rect.width,
  h: rect.height,
});

export function LiquidPopover({
  isOpen,
  onOpenChange,
  trigger,
  triggerRef,
  items,
  label = 'Меню',
  align = 'end',
  preset = 'frosted',
  motion,
}: LiquidPopoverProps) {
  const id = useId().replace(/:/g, ''),
    clipId = `liquid-clip-${id}`,
    filterId = `liquid-filter-${id}`;
  const measureRef = useRef<HTMLDivElement>(null),
    rowRefs = useRef(new Map<string, HTMLDivElement>());
  const nativeRef = useRef<HTMLDivElement>(null),
    glassRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<SVGSVGElement>(null),
    clipRef = useRef<SVGPathElement>(null);
  const imageRef = useRef<SVGImageElement>(null),
    vectorRef = useRef<SVGFEImageElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null),
    blurRef = useRef<SVGFEGaussianBlurElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null),
    [settled, setSettled] = useState(false);
  const contentRef = useCallback(
    (element: HTMLDivElement | null) => setHost(element),
    [],
  );
  const options = useMemo(() => resolveLiquidMotionOptions(motion), [motion]);
  const contentKey = JSON.stringify(
    items.map((item) => [
      item.id,
      item.label,
      item.disabled,
      item.active,
      item.dividerBefore,
    ]),
  );

  // This is an explicit text/button model, not a screenshot of arbitrary DOM.
  // Read our own measured labels so font settings and native row spacing agree.
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || typeof CanvasRenderingContext2D === 'undefined') return;
    const prepare = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const canvas = element.ownerDocument.createElement('canvas'),
        context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.ceil(bounds.width);
      canvas.height = Math.ceil(bounds.height);
      for (const item of items) {
        const row = rowRefs.current.get(item.id);
        if (!row) continue;
        const rect = row.getBoundingClientRect(),
          style = getComputedStyle(row);
        const x = rect.left - bounds.left,
          y = rect.top - bounds.top;
        if (item.dividerBefore) {
          context.globalAlpha = 1;
          context.fillStyle =
            getComputedStyle(element).getPropertyValue('--ui-color-border');
          context.fillRect(0, y - 9, canvas.width, 1);
        }
        context.globalAlpha = item.disabled ? 0.5 : 1;
        context.fillStyle = style.color;
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.textBaseline = 'alphabetic';
        const metrics = context.measureText(item.label);
        const ascent =
          metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
        const descent =
          metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
        const baseline = y + rect.height / 2 + (ascent - descent) / 2;
        const spacing = Number.parseFloat(style.letterSpacing) || 0;
        let cursor = x + Number.parseFloat(style.paddingLeft);
        if (!spacing) context.fillText(item.label, cursor, baseline);
        else
          for (const character of item.label) {
            context.fillText(character, cursor, baseline);
            cursor += context.measureText(character).width + spacing;
          }
      }
      sourceRef.current = canvas;
    };
    prepare();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(prepare)
        : null;
    observer?.observe(element);
    element.ownerDocument.fonts?.addEventListener('loadingdone', prepare);
    return () => {
      observer?.disconnect();
      element.ownerDocument.fonts?.removeEventListener('loadingdone', prepare);
    };
  }, [contentKey, items]);

  useLayoutEffect(() => {
    if (!isOpen || !host) {
      setSettled(false);
      return;
    }
    const native = nativeRef.current,
      glass = glassRef.current,
      scene = sceneRef.current;
    if (!native || !glass || !scene) return;
    let frame = 0,
      cancelled = false;
    let sizeObserver: ResizeObserver | null = null;
    const finish = () => {
      scene.style.display = 'none';
      native.style.opacity = '1';
      native.style.filter = 'none';
      native.style.transform = 'none';
      glass.style.left = '0';
      glass.style.top = '0';
      glass.style.width = '100%';
      glass.style.height = '100%';
      glass.style.clipPath = 'none';
      glass.style.opacity = '1';
      native.style.borderRadius = `${resolveGlassRadius(host.clientWidth, host.clientHeight)}px`;
      setSettled(true);
    };
    const cancelAndFinish = () => {
      cancelAnimationFrame(frame);
      if (!cancelled) finish();
    };
    setSettled(false);
    native.style.opacity = '0';
    scene.style.display = 'block';
    // Wait one paint frame for the existing Menu's collision placement.
    frame = requestAnimationFrame(() => {
      const sourceBounds = triggerRef.current?.getBoundingClientRect(),
        destinationBounds = host.getBoundingClientRect();
      const source = sourceRef.current;
      if (
        !sourceBounds?.width ||
        !destinationBounds.width ||
        !source ||
        typeof Path2D === 'undefined' ||
        !CSS.supports('mix-blend-mode', 'plus-lighter') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        finish();
        return;
      }
      const rect = toLiquidRect(destinationBounds),
        animation = createLiquidMotion(
          toLiquidRect(sourceBounds),
          rect,
          options,
        );
      // Available height may be smaller than the pre-rendered menu. Crop the
      // texture to the same scroll viewport instead of squeezing its rows.
      const texture = host.ownerDocument.createElement('canvas');
      texture.width = Math.ceil(rect.w);
      texture.height = Math.ceil(rect.h);
      const textureContext = texture.getContext('2d');
      if (!textureContext) {
        finish();
        return;
      }
      textureContext.drawImage(source, 0, 0);
      const canvas = host.ownerDocument.createElement('canvas'),
        map = host.ownerDocument.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const context = canvas.getContext('2d'),
        mapContext = map.getContext('2d');
      if (!context || !mapContext) {
        finish();
        return;
      }
      const left = destinationBounds.left,
        top = destinationBounds.top;
      scene.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
      Object.assign(scene.style, {
        left: `${-left}px`,
        top: `${-top}px`,
        width: `${canvas.width}px`,
        height: `${canvas.height}px`,
      });
      if (typeof ResizeObserver !== 'undefined') {
        sizeObserver = new ResizeObserver(() => {
          const current = host.getBoundingClientRect();
          if (
            Math.abs(current.width - rect.w) > 1 ||
            Math.abs(current.height - rect.h) > 1 ||
            Math.abs(current.left - left) > 1 ||
            Math.abs(current.top - top) > 1
          )
            cancelAndFinish();
        });
        sizeObserver.observe(host);
      }
      const started = performance.now();
      const draw = (now: number) => {
        if (cancelled) return;
        const progress = clamp(
          (now - started) / (animation.totalSeconds * 1000),
        );
        const time = animation.time(progress),
          loops = animation.contour(progress),
          path = animation.path(loops);
        const bounds = contourBounds(loops),
          width = bounds.right - bounds.left,
          height = bounds.bottom - bounds.top;
        const localPath = animation.path(
          loops.map((loop) =>
            loop.map((point) => ({
              x: point.x - bounds.left,
              y: point.y - bounds.top,
            })),
          ),
        );
        Object.assign(glass.style, {
          left: `${bounds.left - left}px`,
          top: `${bounds.top - top}px`,
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: `${resolveGlassRadius(width, height)}px`,
          clipPath: `path('${localPath}')`,
          opacity: '1',
        });
        clipRef.current?.setAttribute('d', path);
        const stretch =
          time >= 1 ? animation.spring((time - 1) * options.duration) : 0;
        paintLiquidMesh(context, texture, loops, time, rect, stretch);
        const fill = time >= 0.8 ? 1 : animation.geometry(time).fill;
        const blur = 16 * (1 - 0.8 * fill) * (1 - progress),
          opacity = smooth(progress / 0.5);
        const handoff = smoother((progress - 0.9) / 0.1);
        imageRef.current?.setAttribute('href', canvas.toDataURL());
        imageRef.current?.setAttribute('width', String(canvas.width));
        imageRef.current?.setAttribute('height', String(canvas.height));
        imageRef.current?.setAttribute(
          'opacity',
          String(opacity * (1 - handoff)),
        );
        blurRef.current?.setAttribute('stdDeviation', String(blur));
        native.style.opacity = String(opacity * handoff);
        native.style.filter = `blur(${blur}px)`;
        native.style.transform = `scale(${1 / (1 + stretch)}, ${1 + stretch})`;
        const strength = 1 - smoother((time - 0.8) / 0.2);
        displacementRef.current?.setAttribute('scale', String(64 * strength));
        if (strength > 0) {
          const vector = paintLiquidMap(mapContext, loops, path);
          for (const [key, value] of Object.entries(vector))
            vectorRef.current?.setAttribute(key, String(value));
        }
        if (progress < 1) frame = requestAnimationFrame(draw);
        else finish();
      };
      draw(started);
    });
    // A viewport/font change invalidates the prepared geometry. Settle safely
    // instead of animating toward stale screen coordinates.
    window.addEventListener('resize', cancelAndFinish);
    window.visualViewport?.addEventListener('resize', cancelAndFinish);
    host.ownerDocument.fonts?.addEventListener('loadingdone', cancelAndFinish);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      sizeObserver?.disconnect();
      window.removeEventListener('resize', cancelAndFinish);
      window.visualViewport?.removeEventListener('resize', cancelAndFinish);
      host.ownerDocument.fonts?.removeEventListener(
        'loadingdone',
        cancelAndFinish,
      );
    };
  }, [isOpen, host, triggerRef, options, contentKey]);

  return (
    <>
      <div
        ref={measureRef}
        className="ui-liquid-popover__measure"
        aria-hidden="true"
        inert
      >
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.dividerBefore ? <div className="ui-menu-divider" /> : null}
            <div
              ref={(element) => {
                if (element) rowRefs.current.set(item.id, element);
                else rowRefs.current.delete(item.id);
              }}
              className={`ui-menu-item ui-text--body${item.active ? ' ui-menu-item--active' : ''}`}
            >
              {item.label}
            </div>
          </Fragment>
        ))}
      </div>
      <Menu
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        trigger={trigger}
        label={label}
        align={align}
        contentRef={contentRef}
        className="ui-liquid-popover"
      >
        <GlassSurface
          ref={glassRef}
          preset={preset}
          optics={false}
          className="ui-liquid-popover__glass"
          aria-hidden="true"
        />
        <div className="ui-liquid-popover__composite">
          <svg
            ref={sceneRef}
            className="ui-liquid-popover__scene"
            aria-hidden="true"
          >
            <defs>
              <clipPath id={clipId}>
                <path ref={clipRef} />
              </clipPath>
              <filter
                id={filterId}
                x="-10%"
                y="-10%"
                width="120%"
                height="120%"
                colorInterpolationFilters="sRGB"
                filterUnits="userSpaceOnUse"
              >
                <feGaussianBlur
                  ref={blurRef}
                  in="SourceGraphic"
                  stdDeviation="16"
                  result="soft"
                />
                <feImage
                  ref={vectorRef}
                  preserveAspectRatio="none"
                  result="map"
                />
                <feDisplacementMap
                  ref={displacementRef}
                  in="soft"
                  in2="map"
                  scale="64"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              <image ref={imageRef} filter={`url(#${filterId})`} />
            </g>
          </svg>
          <div
            ref={nativeRef}
            className="ui-liquid-popover__native"
            inert={!settled}
          >
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.dividerBefore ? <MenuDivider /> : null}
                <MenuItem
                  disabled={item.disabled}
                  active={item.active}
                  onSelect={item.onSelect}
                  aria-checked={item['aria-checked']}
                  aria-current={item['aria-current']}
                >
                  {item.label}
                </MenuItem>
              </Fragment>
            ))}
          </div>
        </div>
      </Menu>
    </>
  );
}
