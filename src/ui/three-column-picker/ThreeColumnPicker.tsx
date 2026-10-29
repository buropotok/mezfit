import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { MezfitPopover } from '../konsta-mezfit';
import { centeredLensScale } from '../time-picker/centeredLensScale';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import {
  resolveTwoColumnPickerLensMode,
  type ResolvedTwoColumnPickerLensMode,
} from '../two-column-picker/lensMode';
import '../time-picker/time-picker.css';

const ROW_HEIGHT = 48;
const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
const WHEEL_PADDING = (WHEEL_HEIGHT - ROW_HEIGHT) / 2;
const LENS_TOP = (WHEEL_HEIGHT - LENS_HEIGHT) / 2;
const LENS_SOURCE_VERTICAL_INSET = 8;
const IOS_LENS_MAGNIFICATION = 1.55;
// Older Telegram WKWebViews do not deliver scrollend; wait for a quiet period
// of native scroll events instead of changing scrollTop during momentum.
const SCROLL_END_FALLBACK_MS = 200;
export type ThreeColumnPickerPart = 'first' | 'second' | 'third';

export interface ThreeColumnPickerParts {
  first: number;
  second: number;
  third: number;
}

export interface ThreeColumnPickerColumn {
  ariaLabel: string;
  values: readonly number[];
  format: (value: number) => string;
  formatAria?: (value: number) => string;
}

export interface ThreeColumnPickerSeparator {
  x: number;
  label: string;
}

export interface ThreeColumnPickerProps {
  opened: boolean;
  value: ThreeColumnPickerParts;
  onChange: (value: ThreeColumnPickerParts) => void;
  onClose: () => void;
  target: HTMLElement | null;
  columns: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>;
  ariaLabel: string;
  lensXs: readonly [number, number, number];
  separators?: readonly ThreeColumnPickerSeparator[];
  header?: ReactNode;
  footer?: ReactNode;
  /** Static interactive lens slots replacing individual wheels when supplied. */
  staticLens?: Partial<Record<ThreeColumnPickerPart, ReactNode>>;
  /** Text at a static slot, rendered through the same optics as wheel values. */
  staticLensValues?: Partial<Record<ThreeColumnPickerPart, string>>;
  staticLensCursors?: Partial<Record<ThreeColumnPickerPart, ReactNode>>;
  popoverRef?: Ref<HTMLElement>;
  onPositioned?: (element: HTMLElement) => void;
  popoverClassName?: string;
  pickerClassName?: string;
  columnsClassName?: string;
}

const PARTS: readonly ThreeColumnPickerPart[] = ['first', 'second', 'third'];

type ScrollTops = ThreeColumnPickerParts;

function valueIndex(column: ThreeColumnPickerColumn, value: number) {
  const index = column.values.indexOf(value);
  if (index < 0) {
    throw new Error(`ThreeColumnPicker value ${value} is not present in ${column.ariaLabel}`);
  }
  return index;
}

function partsKey(value: ThreeColumnPickerParts) {
  return `${value.first}:${value.second}:${value.third}`;
}

function partsEqual(left: ThreeColumnPickerParts, right: ThreeColumnPickerParts) {
  return left.first === right.first
    && left.second === right.second
    && left.third === right.third;
}

function partsToScrollTops(
  columns: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>,
  parts: ThreeColumnPickerParts,
): ScrollTops {
  return {
    first: valueIndex(columns.first, parts.first) * ROW_HEIGHT,
    second: valueIndex(columns.second, parts.second) * ROW_HEIGHT,
    third: valueIndex(columns.third, parts.third) * ROW_HEIGHT,
  };
}

function scrollColumn(element: HTMLDivElement | null, index: number) {
  if (!element) return;

  const top = index * ROW_HEIGHT;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top, behavior: 'auto' });
  } else {
    element.scrollTop = top;
  }
}

function visibleLensItems(values: readonly number[], scrollTop: number) {
  const centerIndex = Math.round(scrollTop / ROW_HEIGHT);
  const start = Math.max(0, centerIndex - 1);
  const end = Math.min(values.length - 1, centerIndex + 1);

  return values.slice(start, end + 1).map((value, localIndex) => {
    const index = start + localIndex;
    const globalCenter = WHEEL_PADDING + index * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollTop;

    return {
      index,
      value,
      y: globalCenter - LENS_TOP,
    };
  });
}

function iosLensScale(y: number) {
  const centerDistance = Math.abs(y - LENS_HEIGHT / 2);
  const progress = Math.max(0, 1 - centerDistance / (LENS_HEIGHT / 2));
  const eased = progress * progress * (3 - 2 * progress);
  return 1 + (IOS_LENS_MAGNIFICATION - 1) * eased;
}

function LensText({
  x,
  column,
  scrollTop,
  lensMode,
  textRef,
}: {
  x: number;
  column: ThreeColumnPickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
  textRef?: Ref<SVGTextElement>;
}) {
  return (
    <>
      {visibleLensItems(column.values, scrollTop).map(({ index, value, y }) => {
        const scale = lensMode === 'ios' ? iosLensScale(y) : 1;
        const transform = lensMode === 'ios' && scale !== 1
          ? centeredLensScale(x, y, scale)
          : undefined;

        return (
          <text
            ref={textRef}
            key={index}
            x={x}
            y={y}
            transform={transform}
            textAnchor="middle"
            dominantBaseline="central"
            className="ui-time-picker__lens-text ui-text--title"
          >
            {column.format(value)}
          </text>
        );
      })}
    </>
  );
}

/** Owns the measured text and its trailing 50 CSS px cursor. */
function StaticLensValue({ part, x, value, column, lensMode, cursor }: {
  part: ThreeColumnPickerPart;
  x: number;
  value: string;
  column: ThreeColumnPickerColumn;
  lensMode: ResolvedTwoColumnPickerLensMode;
  cursor?: ReactNode;
}) {
  const textRef = useRef<SVGTextElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const [geometry, setGeometry] = useState({ halfText: 0, width: 50, height: 50, gap: 0 });
  useLayoutEffect(() => {
    if (!cursor) return;
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const svg = group.ownerSVGElement?.getBoundingClientRect();
      const scaleX = svg?.width ? LENS_WIDTH / svg.width : 1;
      const scaleY = svg?.height ? LENS_HEIGHT / svg.height : 1;
      const next = {
        halfText: (textRef.current?.getBoundingClientRect().width ?? 0) * scaleX / 2,
        width: 50 * scaleX,
        height: 50 * scaleY,
        gap: value ? 2 * scaleX : 0,
      };
      setGeometry(current => current.halfText === next.halfText && current.width === next.width
        && current.height === next.height && current.gap === next.gap ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (textRef.current) observer?.observe(textRef.current);
    if (group.ownerSVGElement) observer?.observe(group.ownerSVGElement);
    void group.ownerDocument.fonts?.ready.then(measure);
    return () => { cancelled = true; observer?.disconnect(); };
  }, [value, lensMode, cursor]);

  return (
    <g ref={groupRef} data-ui-picker-static-value={part}>
      {value !== '' ? (
        <LensText x={x} column={{ ...column, values: [0], format: () => value }}
          scrollTop={0} lensMode={lensMode} textRef={textRef} />
      ) : null}
      {cursor ? (
        <foreignObject
          data-ui-picker-cursor={part}
          x={x + geometry.halfText + geometry.gap - geometry.width / 2}
          y={(LENS_HEIGHT - geometry.height) / 2}
          width={geometry.width}
          height={geometry.height}
        >
          {cursor}
        </foreignObject>
      ) : null}
    </g>
  );
}

function PickerLens({
  assets,
  scrollTops,
  lensMode,
  columns,
  lensXs,
  separators = [],
  staticLens,
  staticLensValues,
  staticLensCursors,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  lensMode: ResolvedTwoColumnPickerLensMode;
  columns: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>;
  lensXs: readonly [number, number, number];
  separators?: readonly ThreeColumnPickerSeparator[];
  staticLens?: Partial<Record<ThreeColumnPickerPart, ReactNode>>;
  staticLensValues?: Partial<Record<ThreeColumnPickerPart, string>>;
  staticLensCursors?: Partial<Record<ThreeColumnPickerPart, ReactNode>>;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-three-column-picker-lens-${reactId}`;
  const clipId = `ui-three-column-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-three-column-picker-lens-source-clip-${reactId}`;
  const lensContent = (
    <>
      <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
      {PARTS.map((part, index) => staticLens?.[part] ? null : (
        <LensText
          key={part}
          x={lensXs[index]}
          column={columns[part]}
          scrollTop={scrollTops[part]}
          lensMode={lensMode}
        />
      ))}
      {PARTS.map((part, index) => staticLensValues?.[part] !== undefined ? (
        <StaticLensValue key={part} part={part} x={lensXs[index]}
          value={staticLensValues?.[part] ?? ''} column={columns[part]}
          lensMode={lensMode} cursor={staticLensCursors?.[part]} />
      ) : null)}
      {separators.map(({ x, label }, index) => (
        <text
          key={index}
          x={x}
          y={LENS_HEIGHT / 2}
          transform={lensMode === 'ios'
            ? centeredLensScale(x, LENS_HEIGHT / 2, IOS_LENS_MAGNIFICATION)
            : undefined}
          textAnchor="middle"
          dominantBaseline="central"
          className="ui-time-picker__lens-separator ui-text--title"
        >
          {label}
        </text>
      ))}
    </>
  );

  return (
    <div
      className="ui-time-picker__lens"
      data-ui-time-picker-lens-mode={lensMode}
      aria-hidden={staticLens ? undefined : true}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${LENS_WIDTH} ${LENS_HEIGHT}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <rect width={LENS_WIDTH} height={LENS_HEIGHT} rx={LENS_HEIGHT / 2} />
          </clipPath>
          <clipPath id={sourceClipId} clipPathUnits="userSpaceOnUse">
            <rect
              y={LENS_SOURCE_VERTICAL_INSET}
              width={LENS_WIDTH}
              height={LENS_HEIGHT - LENS_SOURCE_VERTICAL_INSET * 2}
            />
          </clipPath>
          {lensMode === 'displacement' && assets ? (
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={LENS_WIDTH}
              height={LENS_HEIGHT}
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={assets.zoomHref}
                x="0"
                y="0"
                width={LENS_WIDTH}
                height={LENS_HEIGHT}
                preserveAspectRatio="none"
                result="zoomMap"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="zoomMap"
                scale={assets.zoomScale}
                xChannelSelector="R"
                yChannelSelector="G"
                result="zoomed"
              />
              <feImage
                href={assets.edgeHref}
                x="0"
                y="0"
                width={LENS_WIDTH}
                height={LENS_HEIGHT}
                preserveAspectRatio="none"
                result="edgeMap"
              />
              <feDisplacementMap
                in="zoomed"
                in2="edgeMap"
                scale={assets.edgeScale}
                xChannelSelector="R"
                yChannelSelector="G"
                result="refracted"
              />
            </filter>
          ) : null}
        </defs>

        {lensMode === 'ios' ? (
          <g clipPath={`url(#${clipId})`}>{lensContent}</g>
        ) : (
          <g clipPath={`url(#${clipId})`}>
            <g filter={assets ? `url(#${filterId})` : undefined}>
              <g clipPath={`url(#${sourceClipId})`}>{lensContent}</g>
            </g>
          </g>
        )}
      </svg>
      {staticLens ? (
        <div className="ui-time-picker__lens-actions">
          {PARTS.map((part, index) => staticLens[part] ? (
            <div
              key={part}
              className="ui-time-picker__lens-action-slot"
              style={{ left: `${lensXs[index] / LENS_WIDTH * 100}%` }}
            >
              {staticLens[part]}
            </div>
          ) : null)}
        </div>
      ) : null}
    </div>
  );
}

function ThreeColumnPickerColumnWheel({
  part,
  column,
  selected,
  onScroll,
  onScrollEnd,
  onSelect,
  setColumnRef,
}: {
  part: ThreeColumnPickerPart;
  column: ThreeColumnPickerColumn;
  selected: number;
  onScroll: (part: ThreeColumnPickerPart, event: UIEvent<HTMLDivElement>) => void;
  onScrollEnd: (part: ThreeColumnPickerPart) => void;
  onSelect: (part: ThreeColumnPickerPart, index: number) => void;
  setColumnRef: (part: ThreeColumnPickerPart, element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(element) => setColumnRef(part, element)}
      className="ui-time-picker__column"
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(part, event)}
      onScrollEnd={() => onScrollEnd(part)}
    >
      {column.values.map((value, index) => {
        const isSelected = value === selected;
        const label = column.format(value);

        return (
          <button
            key={value}
            type="button"
            className={`ui-time-picker__option ui-text--body${isSelected ? ' ui-time-picker__option--selected' : ''}`}
            role="option"
            aria-label={column.formatAria?.(value) ?? label}
            aria-selected={isSelected}
            onClick={() => onSelect(part, index)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ThreeColumnPicker({
  opened,
  value,
  onChange,
  onClose,
  target,
  columns,
  ariaLabel,
  lensXs,
  separators,
  header,
  footer,
  staticLens,
  staticLensValues,
  staticLensCursors,
  popoverRef,
  onPositioned,
  popoverClassName,
  pickerClassName,
  columnsClassName,
}: ThreeColumnPickerProps) {
  const valueParts = value;
  const resolvedLensMode = resolveTwoColumnPickerLensMode('auto');
  const columnRefs = useRef<Record<ThreeColumnPickerPart, HTMLDivElement | null>>({
    first: null,
    second: null,
    third: null,
  });
  const frameRefs = useRef<Record<ThreeColumnPickerPart, number | null>>({
    first: null,
    second: null,
    third: null,
  });
  const draftRef = useRef<ThreeColumnPickerParts>(valueParts);
  const controlledRef = useRef<ThreeColumnPickerParts>(valueParts);
  const onChangeRef = useRef(onChange);
  const openedRef = useRef(opened);
  const wasOpenedRef = useRef(false);
  const reconcileFrameRef = useRef<number | null>(null);
  // Parent acknowledgements can arrive after further native scroll frames.
  const locallyEmittedRef = useRef<Set<string>>(new Set());
  const scrollingPartsRef = useRef<Set<ThreeColumnPickerPart>>(new Set());
  const scrollEndFallbackRefs = useRef<Record<ThreeColumnPickerPart, number | null>>({
    first: null,
    second: null,
    third: null,
  });
  const [draft, setDraft] = useState<ThreeColumnPickerParts>(valueParts);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, valueParts));
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = valueParts;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  const cancelScheduledFrames = (view: Window) => {
    PARTS.forEach((part) => {
      const fallbackTimer = scrollEndFallbackRefs.current[part];
      if (fallbackTimer !== null) {
        view.clearTimeout(fallbackTimer);
        scrollEndFallbackRefs.current[part] = null;
      }
      const frame = frameRefs.current[part];
      if (frame !== null) {
        view.cancelAnimationFrame(frame);
        frameRefs.current[part] = null;
      }
    });

    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
  };

  const syncColumns = (parts: ThreeColumnPickerParts) => {
    PARTS.forEach((part) => {
      const index = columns[part].values.indexOf(parts[part]);
      if (index >= 0) scrollColumn(columnRefs.current[part], index);
    });
  };

  useEffect(() => {
    if (resolvedLensMode !== 'displacement' || !opened || lensAssets) return undefined;

    const documentRef = target?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!documentRef) return undefined;

    let cancelled = false;
    const view = documentRef.defaultView;
    const build = () => {
      if (!cancelled) setLensAssets(buildTimeLensAssets(documentRef, lensXs));
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
  }, [lensAssets, lensXs, opened, resolvedLensMode, target]);

  useEffect(() => {
    const view = target?.ownerDocument.defaultView ?? window;

    if (!opened) {
      cancelScheduledFrames(view);
      wasOpenedRef.current = false;
      locallyEmittedRef.current.clear();
      scrollingPartsRef.current.clear();
      return;
    }

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    const valueChanged = !partsEqual(draftRef.current, valueParts);
    if (!justOpened && !valueChanged) return;
    // Delayed echoes of earlier steps must not steer a moving wheel.
    if (!justOpened && locallyEmittedRef.current.has(partsKey(valueParts))) return;
    locallyEmittedRef.current.clear();

    cancelScheduledFrames(view);
    draftRef.current = valueParts;
    setDraft(valueParts);
    const nextScrollTops = partsToScrollTops(columns, valueParts);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    view.requestAnimationFrame(() => {
      if (!openedRef.current) return;
      syncColumns(valueParts);
    });
  }, [opened, target, columns, valueParts.first, valueParts.second, valueParts.third]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
    cancelScheduledFrames(view);
  }, [target]);

  const commitIndex = (part: ThreeColumnPickerPart, index: number) => {
    const column = columns[part];
    const clampedIndex = Math.max(0, Math.min(column.values.length - 1, index));
    const nextPartValue = column.values[clampedIndex];
    const current = draftRef.current;
    const next = { ...current, [part]: nextPartValue };
    if (partsEqual(next, current)) return;

    draftRef.current = next;
    setDraft(next);
    locallyEmittedRef.current.add(partsKey(next));
    onChangeRef.current(next);
  };

  const handleScrollEnd = (part: ThreeColumnPickerPart) => {
    if (!openedRef.current) return;
    const element = columnRefs.current[part];
    if (!element) return;
    const view = element.ownerDocument.defaultView ?? window;
    const pendingTimer = scrollEndFallbackRefs.current[part];
    if (pendingTimer !== null) {
      view.clearTimeout(pendingTimer);
      scrollEndFallbackRefs.current[part] = null;
    }
    scrollingPartsRef.current.delete(part);
    const column = columns[part];
    const index = Math.max(0, Math.min(column.values.length - 1, Math.round(element.scrollTop / ROW_HEIGHT)));
    commitIndex(part, index);
    if (scrollingPartsRef.current.size > 0) return;

    // Only reconcile a rejected controlled value after all wheels stop.
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current || scrollingPartsRef.current.size > 0) return;
      const canonical = controlledRef.current;
      if (!partsEqual(draftRef.current, canonical)) {
        draftRef.current = canonical;
        setDraft(canonical);
        const activeColumns = columns;
        if (PARTS.every((candidate) => activeColumns[candidate].values.includes(canonical[candidate]))) {
          const tops = partsToScrollTops(activeColumns, canonical);
          pendingScrollRef.current = tops;
          setScrollTops(tops);
          syncColumns(canonical);
        }
      }
      locallyEmittedRef.current.clear();
    });
  };

  const scheduleScrollEndFallback = (part: ThreeColumnPickerPart, element: HTMLDivElement) => {
    // Modern WebViews dispatch scrollend. Older ones need an inactivity
    // fallback; restarting its timer never interferes with native deceleration.
    if (typeof (element as HTMLDivElement & { onscrollend?: unknown }).onscrollend !== 'undefined') return;
    const view = element.ownerDocument.defaultView ?? window;
    const previous = scrollEndFallbackRefs.current[part];
    if (previous !== null) view.clearTimeout(previous);
    scrollEndFallbackRefs.current[part] = view.setTimeout(() => {
      scrollEndFallbackRefs.current[part] = null;
      handleScrollEnd(part);
    }, SCROLL_END_FALLBACK_MS);
  };

  const handleScroll = (
    part: ThreeColumnPickerPart,
    event: UIEvent<HTMLDivElement>,
  ) => {
    if (!openedRef.current) return;

    const top = event.currentTarget.scrollTop;
    scrollingPartsRef.current.add(part);
    if (reconcileFrameRef.current !== null) {
      (event.currentTarget.ownerDocument.defaultView ?? window).cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: top,
    };
    scheduleScrollEndFallback(part, event.currentTarget);

    if (frameRefs.current[part] !== null) return;

    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    frameRefs.current[part] = view.requestAnimationFrame(() => {
      frameRefs.current[part] = null;
      if (!openedRef.current) return;

      const nextTop = pendingScrollRef.current[part];
      setScrollTops((current) => ({ ...current, [part]: nextTop }));
      commitIndex(part, Math.round(nextTop / ROW_HEIGHT));
    });
  };

  const handleSelect = (part: ThreeColumnPickerPart, index: number) => {
    if (!openedRef.current) return;

    commitIndex(part, index);
    const nextTop = index * ROW_HEIGHT;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [part]: nextTop }));
    const element = columnRefs.current[part];
    scrollColumn(element, index);
    if (element) scheduleScrollEndFallback(part, element);
  };

  const flushWheels = () => {
    PARTS.forEach((part) => {
      if (staticLens?.[part]) return;
      const element = columnRefs.current[part];
      if (!element) return;
      commitIndex(part, Math.round(element.scrollTop / ROW_HEIGHT));
    });
  };

  const handleClose = () => {
    flushWheels();
    onClose();
  };

  const setColumnRef = (
    part: ThreeColumnPickerPart,
    element: HTMLDivElement | null,
  ) => {
    columnRefs.current[part] = element;
  };

  return (
    <MezfitPopover
      ref={popoverRef}
      onPositioned={onPositioned}
      opened={opened}
      target={target ?? undefined}
      angle={false}
      viewportTop={100}
      scrollable
      portal={typeof document !== 'undefined' ? document.getElementById('root') ?? true : false}
      backdrop
      iosHighlight={false}
      onBackdropClick={handleClose}
      className={`ui-time-picker__popover${popoverClassName ? ` ${popoverClassName}` : ''}`}
      style={{ width: '336px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-hidden={opened ? undefined : true}
      inert={!opened ? true : undefined}
    >
      <div className={`ui-time-picker${pickerClassName ? ` ${pickerClassName}` : ''}`}>
        {header}
        <div className="ui-time-picker__wheel">
          <div className={`ui-time-picker__columns${columnsClassName ? ` ${columnsClassName}` : ''}`}>
            {PARTS.map((part) => staticLens?.[part] ? (
              <div key={part} className="ui-time-picker__static-column" aria-hidden="true" />
            ) : (
              <ThreeColumnPickerColumnWheel
                key={part}
                part={part}
                column={columns[part]}
                selected={draft[part]}
                onScroll={handleScroll}
                onScrollEnd={handleScrollEnd}
                onSelect={handleSelect}
                setColumnRef={setColumnRef}
              />
            ))}
          </div>
          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            lensMode={resolvedLensMode}
            columns={columns}
            lensXs={lensXs}
            separators={separators}
            staticLens={staticLens}
            staticLensValues={staticLensValues}
            staticLensCursors={staticLensCursors}
          />
        </div>
        {footer ? <div onClickCapture={flushWheels}>{footer}</div> : null}
      </div>
    </MezfitPopover>
  );
}
