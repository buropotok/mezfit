import {
  Fragment,
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type RefObject,
} from 'react';
import { GlassSurface } from './GlassSurface';
import { MezfitPopover } from './konsta-mezfit/Popover';
import './menu.css';
import { resolveGlassRadius, type GlassPresetName } from './glassMaterial';
import {
  clamp,
  contourBounds,
  paintLiquidMesh,
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
  'aria-current'?: 'page' | 'date';
};

export type LiquidPopoverLayout = 'menu' | 'grid';
export type LiquidPopoverRole = 'menu' | 'dialog';

export interface LiquidPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Controlled preserves the trigger owner's delayed activation (e.g. Navbar). */
  triggerActivation?: 'automatic' | 'controlled';
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  /** The whole originating surface, e.g. Navbar's right capsule or a circular button. */
  triggerRef: RefObject<HTMLElement | null>;
  items: readonly LiquidPopoverItem[];
  label?: string;
  preset?: GlassPresetName;
  optics?: boolean;
  layout?: LiquidPopoverLayout;
  columns?: number;
  role?: LiquidPopoverRole;
  scrollActiveIntoView?: boolean;
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

function paintContentTexture(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  rows: ReadonlyMap<string, HTMLElement>,
  items: readonly LiquidPopoverItem[],
  layout: LiquidPopoverLayout,
  bounds = container.getBoundingClientRect(),
) {
  if (!bounds.width || !bounds.height) return false;
  const context = canvas.getContext('2d');
  if (!context) return false;
  canvas.width = Math.max(1, Math.ceil(bounds.width));
  canvas.height = Math.max(1, Math.ceil(bounds.height));
  const containerStyle = getComputedStyle(container);
  for (const item of items) {
    const row = rows.get(item.id);
    if (!row) continue;
    const rect = row.getBoundingClientRect(),
      style = getComputedStyle(row),
      x = rect.left - bounds.left,
      y = rect.top - bounds.top;
    if (item.dividerBefore) {
      context.globalAlpha = 1;
      context.fillStyle = containerStyle.getPropertyValue('--ui-color-border');
      context.fillRect(0, y - 9, canvas.width, 1);
    }
    context.globalAlpha = item.disabled ? 0.5 : 1;
    context.fillStyle = style.color;
    context.font =
      `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.textBaseline = 'alphabetic';
    const metrics = context.measureText(item.label),
      ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
      descent =
        metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent,
      baseline = y + rect.height / 2 + (ascent - descent) / 2,
      spacing = Number.parseFloat(style.letterSpacing) || 0,
      characters = Array.from(item.label),
      textWidth = spacing
        ? characters.reduce(
            (width, character, index) =>
              width +
              context.measureText(character).width +
              (index < characters.length - 1 ? spacing : 0),
            0,
          )
        : metrics.width;
    let cursor =
      layout === 'grid'
        ? x + (rect.width - textWidth) / 2
        : x + (Number.parseFloat(style.paddingLeft) || 0);
    if (!spacing) context.fillText(item.label, cursor, baseline);
    else
      for (const character of characters) {
        context.fillText(character, cursor, baseline);
        cursor += context.measureText(character).width + spacing;
      }
  }
  context.globalAlpha = 1;
  return true;
}

export function LiquidPopover({
  isOpen,
  onOpenChange,
  trigger,
  triggerRef,
  items,
  label = 'Меню',
  triggerActivation = 'automatic',
  preset = 'frosted',
  optics = false,
  layout = 'menu',
  columns = 4,
  role = 'menu',
  scrollActiveIntoView = false,
  motion,
}: LiquidPopoverProps) {
  const id = useId().replace(/:/g, ''),
    clipId = `liquid-clip-${id}`;
  const measureRef = useRef<HTMLDivElement>(null),
    rowRefs = useRef(new Map<string, HTMLDivElement>());
  const nativeRef = useRef<HTMLDivElement>(null),
    nativeRowRefs = useRef(new Map<string, HTMLButtonElement>()),
    glassRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<SVGSVGElement>(null),
    clipRef = useRef<SVGPathElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null),
    itemsRef = useRef(items),
    progressRef = useRef(0);
  itemsRef.current = items;
  const [host, setHost] = useState<HTMLElement | null>(null),
    [settled, setSettled] = useState(false),
    [positioned, setPositioned] = useState(false),
    [presented, setPresented] = useState(isOpen);
  const handlePositioned = useCallback(() => setPositioned(true), []);
  const contentRef = useCallback(
    (element: HTMLElement | null) => setHost(element),
    [],
  );
  const options = useMemo(() => resolveLiquidMotionOptions(motion), [motion]);
  const resolvedColumns = Math.max(1, Math.min(8, Math.floor(columns || 1)));
  const gridStyle = layout === 'grid'
    ? ({ '--ui-liquid-popover-columns': String(resolvedColumns) } as CSSProperties)
    : undefined;
  const activeItemId = items.find((item) => item.active)?.id;
  const centerActiveItem = useCallback((container: HTMLElement | null, item: HTMLElement | null) => {
    if (!scrollActiveIntoView || !container || !item) return;
    const target = item.offsetTop + item.offsetHeight / 2 - container.clientHeight / 2;
    container.scrollTop = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));
  }, [scrollActiveIntoView]);
  const contentKey = JSON.stringify([
    layout,
    resolvedColumns,
    items.map((item) => [
      item.id,
      item.label,
      item.disabled,
      item.active,
      item.dividerBefore,
    ]),
  ]);

  // Prewarm text/font measurement while closed. The opening frame repaints the
  // same canvas from the positioned native rows so raster and HTML share one
  // final coordinate system.
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || typeof CanvasRenderingContext2D === 'undefined') return;
    const prepare = () => {
      centerActiveItem(
        element,
        activeItemId ? rowRefs.current.get(activeItemId) ?? null : null,
      );
      const canvas =
        sourceRef.current ?? element.ownerDocument.createElement('canvas');
      if (
        paintContentTexture(
          canvas,
          element,
          rowRefs.current,
          itemsRef.current,
          layout,
        )
      )
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
  }, [activeItemId, centerActiveItem, contentKey, layout]);

  useLayoutEffect(() => {
    if (isOpen) setPresented(true);
  }, [isOpen]);

  useLayoutEffect(() => {
    const visible = isOpen || presented;
    if (!visible || !host || !positioned) {
      if (nativeRef.current) nativeRef.current.style.opacity = '0';
      if (glassRef.current) glassRef.current.style.opacity = '0';
      if (canvasRef.current) canvasRef.current.style.opacity = '0';
      if (!isOpen) {
        progressRef.current = 0;
        setSettled(false);
        setPositioned(false);
        setPresented(false);
      }
      return;
    }

    const native = nativeRef.current,
      glass = glassRef.current,
      scene = sceneRef.current,
      canvas = canvasRef.current;
    if (!native || !glass || !scene || !canvas) return;

    let frame = 0,
      cancelled = false;
    let sizeObserver: ResizeObserver | null = null;
    const targetProgress = isOpen ? 1 : 0;

    const finishOpen = () => {
      progressRef.current = 1;
      scene.style.display = 'none';
      canvas.style.display = 'none';
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

    const finishClose = () => {
      progressRef.current = 0;
      scene.style.display = 'none';
      canvas.style.display = 'none';
      canvas.style.opacity = '0';
      native.style.opacity = '0';
      native.style.filter = 'none';
      native.style.transform = 'none';
      glass.style.opacity = '0';
      setSettled(false);
      setPositioned(false);
      setPresented(false);
    };

    const finishTarget = () => {
      if (targetProgress === 1) finishOpen();
      else finishClose();
    };

    const cancelAndFinish = () => {
      cancelAnimationFrame(frame);
      if (!cancelled) finishTarget();
    };

    setSettled(false);
    scene.style.display = 'block';
    canvas.style.display = 'block';
    if (progressRef.current <= 0) {
      native.style.opacity = '0';
      canvas.style.opacity = '0';
      glass.style.opacity = '0';
    }

    // Shared MezfitPopover owns placement; wait for its positioned frame.
    frame = requestAnimationFrame(() => {
      const sourceBounds = triggerRef.current?.getBoundingClientRect(),
        destinationBounds = host.getBoundingClientRect();
      if (
        !sourceBounds?.width ||
        !destinationBounds.width ||
        typeof Path2D === 'undefined' ||
        !CSS.supports('mix-blend-mode', 'plus-lighter') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        finishTarget();
        return;
      }

      const rect = toLiquidRect(destinationBounds),
        animation = createLiquidMotion(
          toLiquidRect(sourceBounds),
          rect,
          options,
        );

      // Reset transient reverse/forward transforms only inside the same RAF
      // where the current progress is redrawn, so no untransformed frame can
      // reach the screen.
      native.style.transform = 'none';
      native.style.filter = 'none';
      centerActiveItem(
        native,
        activeItemId ? nativeRowRefs.current.get(activeItemId) ?? null : null,
      );

      const texture =
        sourceRef.current ?? host.ownerDocument.createElement('canvas');
      if (
        !paintContentTexture(
          texture,
          native,
          nativeRowRefs.current,
          itemsRef.current,
          layout,
          destinationBounds,
        )
      ) {
        finishTarget();
        return;
      }
      sourceRef.current = texture;

      const cropX = Math.floor(
        Math.max(0, Math.min(sourceBounds.left, destinationBounds.left) - 80),
      );
      const cropY = Math.floor(
        Math.max(0, Math.min(sourceBounds.top, destinationBounds.top) - 80),
      );
      canvas.width = Math.max(
        1,
        Math.ceil(
          Math.min(
            window.innerWidth,
            Math.max(sourceBounds.right, destinationBounds.right) + 80,
          ) - cropX,
        ),
      );
      canvas.height = Math.max(
        1,
        Math.ceil(
          Math.min(
            window.innerHeight,
            Math.max(sourceBounds.bottom, destinationBounds.bottom) + 80,
          ) - cropY,
        ),
      );
      const context = canvas.getContext('2d');
      if (!context) {
        finishTarget();
        return;
      }

      const left = destinationBounds.left,
        top = destinationBounds.top;
      Object.assign(canvas.style, {
        left: `${cropX - left}px`,
        top: `${cropY - top}px`,
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

      const fromProgress = progressRef.current,
        progressDistance = Math.abs(targetProgress - fromProgress),
        durationMs = animation.totalSeconds * 1000 * progressDistance,
        started = performance.now();

      const draw = (now: number) => {
        if (cancelled) return;
        const phase =
            durationMs <= 0 ? 1 : clamp((now - started) / durationMs),
          progress =
            fromProgress + (targetProgress - fromProgress) * phase;
        progressRef.current = progress;

        const loops = animation.contour(progress),
          timeline = animation.timeline(progress);
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

        const localLoops = loops.map((loop) =>
          loop.map((point) => ({ x: point.x - cropX, y: point.y - cropY })),
        );
        const canvasPath = animation.path(localLoops);
        clipRef.current?.setAttribute('d', canvasPath);
        paintLiquidMesh(
          context,
          texture,
          localLoops,
          timeline.shape,
          { ...rect, x: rect.x - cropX, y: rect.y - cropY },
          0,
          timeline.lens,
          progress >= 1,
        );

        const centerX = (bounds.left + bounds.right) / 2,
          centerY = (bounds.top + bounds.bottom) / 2,
          scaleX = width / rect.w,
          scaleY = height / rect.h,
          offsetX = centerX - rect.x,
          offsetY = centerY - rect.y;
        canvas.style.opacity = String(
          timeline.opacity * (1 - timeline.handoff),
        );
        canvas.style.filter = `blur(${timeline.blur}px)`;
        native.style.opacity = String(timeline.opacity * timeline.handoff);
        native.style.filter = `blur(${timeline.blur}px)`;
        native.style.transformOrigin = 'center center';
        native.style.transform =
          `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`;

        if (phase < 1) frame = requestAnimationFrame(draw);
        else finishTarget();
      };

      draw(started);
    });

    // A viewport/font change invalidates the prepared geometry. Settle safely
    // to the requested endpoint instead of animating stale coordinates.
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
  }, [
    activeItemId,
    centerActiveItem,
    contentKey,
    host,
    isOpen,
    layout,
    options,
    positioned,
    triggerRef,
  ]);

  return (
    <>
      <div
        ref={measureRef}
        className={`ui-liquid-popover__measure${layout === 'grid' ? ' ui-liquid-popover__measure--grid' : ''}`}
        style={gridStyle}
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
      {cloneElement(trigger, {
        'aria-haspopup': role,
        'aria-expanded': isOpen,
        style: {
          ...trigger.props.style,
          visibility:
            isOpen || presented
              ? 'hidden'
              : trigger.props.style?.visibility,
        },
        onClick: (event) => {
          trigger.props.onClick?.(event);
          if (triggerActivation === 'automatic' && !event.defaultPrevented)
            onOpenChange(!isOpen);
        },
      })}
      <MezfitPopover
        opened={isOpen || presented}
        target={triggerRef.current ?? undefined}
        onBackdropClick={isOpen ? () => onOpenChange(false) : undefined}
        presentation="custom"
        onPositioned={handlePositioned}
        portal
        ref={contentRef}
        role={role}
        aria-modal={role === 'dialog' ? 'true' : undefined}
        aria-label={label}
        className={`ui-liquid-popover${layout === 'grid' ? ' ui-liquid-popover--grid' : ''}`}
        style={gridStyle}
      >
        <GlassSurface
          ref={glassRef}
          preset={preset}
          optics={optics}
          className="ui-liquid-popover__glass"
          aria-hidden="true"
        />
        <div className="ui-liquid-popover__composite">
          <svg
            ref={sceneRef}
            width="0"
            height="0"
            aria-hidden="true"
            className="ui-liquid-popover__clip"
          >
            <defs>
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                <path ref={clipRef} />
              </clipPath>
            </defs>
          </svg>
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="ui-liquid-popover__scene"
            style={{ clipPath: `url(#${clipId})` }}
          />
          <div
            ref={nativeRef}
            className={`ui-liquid-popover__native${layout === 'grid' ? ' ui-liquid-popover__native--grid' : ''}`}
            style={gridStyle}
            inert={!settled}
          >
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.dividerBefore ? (
                  <div role="separator" className="ui-menu-divider" />
                ) : null}
                <button
                  ref={(element) => {
                    if (element) nativeRowRefs.current.set(item.id, element);
                    else nativeRowRefs.current.delete(item.id);
                  }}
                  type="button"
                  role={role === 'menu' ? 'menuitem' : undefined}
                  disabled={item.disabled}
                  data-disabled={item.disabled || undefined}
                  className={`ui-menu-item ui-text--body${item.active ? ' ui-menu-item--active' : ''}`}
                  onClick={() => {
                    item.onSelect?.();
                    onOpenChange(false);
                  }}
                  aria-checked={item['aria-checked']}
                  aria-current={item['aria-current']}
                >
                  <span className="ui-menu-item__label">{item.label}</span>
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </MezfitPopover>
    </>
  );
}
