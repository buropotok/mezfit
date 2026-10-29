import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
  type MouseEvent,
  type TouchEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { triggerTelegramPickerSelectionTick } from '../../telegram';
import { nearestSettledIndex } from '../time-picker/forwardSettle';
import { COMPACT_TIME_GEOMETRY, STANDARD_GEOMETRY, type WheelGeometry } from '../time-picker/wheelGeometry';
import { MezfitPopover } from '../konsta-mezfit';
import { centeredLensScale } from '../time-picker/centeredLensScale';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import {
  resolveTwoColumnPickerLensMode,
  type ResolvedTwoColumnPickerLensMode,
} from '../two-column-picker/lensMode';
import '../time-picker/time-picker.css';

const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
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
  geometry?: 'standard' | 'compact-time';
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
  geometry: WheelGeometry,
): ScrollTops {
  return {
    first: valueIndex(columns.first, parts.first) * geometry.rowHeight,
    second: valueIndex(columns.second, parts.second) * geometry.rowHeight,
    third: valueIndex(columns.third, parts.third) * geometry.rowHeight,
  };
}

function scrollColumn(element: HTMLDivElement | null, index: number, geometry: WheelGeometry) {
  if (!element) return;

  const top = index * geometry.rowHeight;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top, behavior: 'auto' });
  } else {
    element.scrollTop = top;
  }
}

function visibleLensItems(values: readonly number[], scrollTop: number, geometry: WheelGeometry) {
  const centerIndex = Math.round(scrollTop / geometry.rowHeight);
  const start = Math.max(0, centerIndex - 1);
  const end = Math.min(values.length - 1, centerIndex + 1);

  return values.slice(start, end + 1).map((value, localIndex) => {
    const index = start + localIndex;
    return {
      index,
      value,
      y: LENS_HEIGHT / 2 + (index * geometry.rowHeight - scrollTop) / geometry.lensScaleY,
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
  geometry = STANDARD_GEOMETRY,
}: {
  x: number;
  column: ThreeColumnPickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
  textRef?: Ref<SVGTextElement>;
  geometry?: WheelGeometry;
}) {
  return (
    <>
      {visibleLensItems(column.values, scrollTop, geometry).map(({ index, value, y }) => {
        const scale = lensMode === 'ios' ? iosLensScale(y) : 1;
        const transform = geometry.glyphScaleY !== 1
          ? `translate(${x} ${y}) scale(${scale} ${scale * geometry.glyphScaleY}) translate(${-x} ${-y})`
          : lensMode === 'ios' && scale !== 1 ? centeredLensScale(x, y, scale) : undefined;

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
  geometry,
}: {
  assets: TimeLensAssets | null;
  geometry: WheelGeometry;
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
          geometry={geometry}
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
          transform={geometry.glyphScaleY !== 1
            ? `translate(${x} ${LENS_HEIGHT / 2}) scale(${lensMode === 'ios' ? IOS_LENS_MAGNIFICATION : 1} ${(lensMode === 'ios' ? IOS_LENS_MAGNIFICATION : 1) * geometry.glyphScaleY}) translate(${-x} ${-LENS_HEIGHT / 2})`
            : lensMode === 'ios' ? centeredLensScale(x, LENS_HEIGHT / 2, IOS_LENS_MAGNIFICATION) : undefined}
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
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  setColumnRef,
}: {
  part: ThreeColumnPickerPart;
  column: ThreeColumnPickerColumn;
  selected: number;
  onScroll: (part: ThreeColumnPickerPart, event: UIEvent<HTMLDivElement>) => void;
  onScrollEnd: (part: ThreeColumnPickerPart) => void;
  onSelect: (part: ThreeColumnPickerPart, index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (part: ThreeColumnPickerPart) => void;
  onTouchCancel: (part: ThreeColumnPickerPart) => void;
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
      onTouchStart={event => onTouchStart(part, event)}
      onTouchMove={event => onTouchMove(part, event)}
      onTouchEnd={() => onTouchEnd(part)}
      onTouchCancel={() => onTouchCancel(part)}
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
            onClick={event => onSelect(part, index, event)}
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
  geometry: geometryName = 'standard',
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
  const geometry = geometryName === 'compact-time' ? COMPACT_TIME_GEOMETRY : STANDARD_GEOMETRY;
  const isCompactWheel = geometryName === 'compact-time';
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
  const positionedPartsRef = useRef(new Set<ThreeColumnPickerPart>());
  const draftRef = useRef<ThreeColumnPickerParts>(valueParts);
  const controlledRef = useRef<ThreeColumnPickerParts>(valueParts);
  const onChangeRef = useRef(onChange);
  const openedRef = useRef(opened);
  const wasOpenedRef = useRef(false);
  const reconcileFrameRef = useRef<number | null>(null);
  const initialSyncFrameRef = useRef<number | null>(null);
  const touchStartRef = useRef<Partial<Record<ThreeColumnPickerPart, number>>>({});
  const suppressTouchClickRef = useRef<Partial<Record<ThreeColumnPickerPart, boolean>>>({});
  const deferredExternalRef = useRef<ThreeColumnPickerParts | null>(null);
  const settleTimersRef = useRef<Partial<Record<ThreeColumnPickerPart, number>>>({});
  const lastTickIndexRef = useRef<Partial<Record<ThreeColumnPickerPart, number>>>({});
  const settlingRef = useRef<Partial<Record<ThreeColumnPickerPart, number>>>({});
  // Parent acknowledgements can arrive after further native scroll frames.
  const locallyEmittedRef = useRef<Set<string>>(new Set());
  const scrollingPartsRef = useRef<Set<ThreeColumnPickerPart>>(new Set());
  const scrollEndFallbackRefs = useRef<Record<ThreeColumnPickerPart, number | null>>({
    first: null,
    second: null,
    third: null,
  });
  const [draft, setDraft] = useState<ThreeColumnPickerParts>(valueParts);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, valueParts, geometry));
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = valueParts;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  const cancelScheduledFrames = (view: Window) => {
    if (initialSyncFrameRef.current !== null) {
      view.cancelAnimationFrame(initialSyncFrameRef.current);
      initialSyncFrameRef.current = null;
    }
    Object.values(settleTimersRef.current).forEach(timer => view.clearTimeout(timer));
    settleTimersRef.current = {};
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
      if (index >= 0 && columnRefs.current[part]) {
        scrollColumn(columnRefs.current[part], index, geometry);
        positionedPartsRef.current.add(part);
      }
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
      positionedPartsRef.current.clear();
      locallyEmittedRef.current.clear();
      scrollingPartsRef.current.clear();
      touchStartRef.current = {};
      suppressTouchClickRef.current = {};
      deferredExternalRef.current = null;
      lastTickIndexRef.current = {};
      settlingRef.current = {};
      return;
    }

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    const valueChanged = !partsEqual(draftRef.current, valueParts);
    // Acknowledgements must not steer native momentum.
    if (!justOpened && (!valueChanged || locallyEmittedRef.current.has(partsKey(valueParts)))) {
      deferredExternalRef.current = null;
      return;
    }
    if (!justOpened && isCompactWheel && (scrollingPartsRef.current.size > 0
      || Object.keys(touchStartRef.current).length > 0 || Object.keys(settlingRef.current).length > 0)) {
      deferredExternalRef.current = valueParts;
      return;
    }
    deferredExternalRef.current = null;
    locallyEmittedRef.current.clear();

    cancelScheduledFrames(view);
    positionedPartsRef.current.clear();
    draftRef.current = valueParts;
    setDraft(valueParts);
    const nextScrollTops = partsToScrollTops(columns, valueParts, geometry);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);
    if (isCompactWheel) {
      lastTickIndexRef.current = {
        first: valueIndex(columns.first, valueParts.first),
        second: valueIndex(columns.second, valueParts.second),
        third: valueIndex(columns.third, valueParts.third),
      };
      settlingRef.current = {};
    }

    initialSyncFrameRef.current = view.requestAnimationFrame(() => {
      initialSyncFrameRef.current = null;
      if (!openedRef.current || (isCompactWheel && scrollingPartsRef.current.size > 0)) return;
      syncColumns(valueParts);
    });
  }, [opened, target, columns, geometryName, valueParts.first, valueParts.second, valueParts.third]);

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

  const reconcileDeferredValue = () => {
    if (scrollingPartsRef.current.size > 0 || Object.keys(settlingRef.current).length > 0) return;
    const external = deferredExternalRef.current;
    deferredExternalRef.current = null;
    if (external && !locallyEmittedRef.current.has(partsKey(external))) {
      draftRef.current = external;
      setDraft(external);
      const tops = partsToScrollTops(columns, external, geometry);
      pendingScrollRef.current = tops;
      setScrollTops(tops);
      lastTickIndexRef.current = {
        first: valueIndex(columns.first, external.first),
        second: valueIndex(columns.second, external.second),
        third: valueIndex(columns.third, external.third),
      };
      syncColumns(external);
    }
    locallyEmittedRef.current.clear();
  };

  const handleTouchStart = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    if (!isCompactWheel) return;
    suppressTouchClickRef.current[part] = false;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    if (initialSyncFrameRef.current !== null) {
      view.cancelAnimationFrame(initialSyncFrameRef.current);
      initialSyncFrameRef.current = null;
    }
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
    if (settlingRef.current[part] !== undefined) {
      delete settlingRef.current[part];
      view.clearTimeout(settleTimersRef.current[part]);
      delete settleTimersRef.current[part];
      event.currentTarget.scrollTo({ top: event.currentTarget.scrollTop, behavior: 'auto' });
    }
    const touch = event.touches[0];
    if (touch) touchStartRef.current[part] = touch.clientY;
  };

  const handleTouchMove = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartRef.current[part];
    const touch = event.touches[0];
    if (startY !== undefined && touch && Math.abs(touch.clientY - startY) > 8) {
      suppressTouchClickRef.current[part] = true;
    }
  };

  const handleTouchEnd = (part: ThreeColumnPickerPart) => {
    delete touchStartRef.current[part];
  };

  const handleTouchCancel = (part: ThreeColumnPickerPart) => {
    if (touchStartRef.current[part] !== undefined) suppressTouchClickRef.current[part] = true;
    delete touchStartRef.current[part];
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
    if (isCompactWheel && touchStartRef.current[part] !== undefined) return;
    if (isCompactWheel) {
      // Native scrolling stays free until it ends, then align the nearest
      // cell center to the horizontal selection line.
      const currentTop = element.scrollTop;
      const activeTarget = settlingRef.current[part];
      if (activeTarget !== undefined) {
        if (Math.abs(currentTop - activeTarget) > 0.5) return;
        delete settlingRef.current[part];
        view.clearTimeout(settleTimersRef.current[part]);
        delete settleTimersRef.current[part];
        commitIndex(part, Math.round(activeTarget / geometry.rowHeight));
        scrollingPartsRef.current.delete(part);
        reconcileDeferredValue();
        return;
      }
      const column = columns[part];
      const index = nearestSettledIndex(currentTop, geometry.rowHeight, column.values.length);
      const targetTop = index * geometry.rowHeight;
      commitIndex(part, index);
      if (Math.abs(targetTop - currentTop) > 0.5) {
        settlingRef.current[part] = targetTop;
        element.scrollTo({ top: targetTop, behavior: 'smooth' });
        // Some Telegram WebViews omit scrollend for programmatic smooth scroll.
        // This timer starts only AFTER native momentum ended, never during it.
        settleTimersRef.current[part] = view.setTimeout(() => {
          if (!openedRef.current || settlingRef.current[part] !== targetTop) return;
          if (Math.abs(element.scrollTop - targetTop) > 0.5) {
            element.scrollTo({ top: targetTop, behavior: 'auto' });
          }
          delete settlingRef.current[part];
          delete settleTimersRef.current[part];
          commitIndex(part, index);
          scrollingPartsRef.current.delete(part);
          reconcileDeferredValue();
        }, 400);
      } else {
        scrollingPartsRef.current.delete(part);
        reconcileDeferredValue();
      }
      return;
    }
    scrollingPartsRef.current.delete(part);
    const column = columns[part];
    const index = Math.max(0, Math.min(column.values.length - 1, Math.round(element.scrollTop / geometry.rowHeight)));
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
          const tops = partsToScrollTops(activeColumns, canonical, geometry);
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
    if (settlingRef.current[part] !== undefined
      || typeof (element as HTMLDivElement & { onscrollend?: unknown }).onscrollend !== 'undefined') return;
    const view = element.ownerDocument.defaultView ?? window;
    const previous = scrollEndFallbackRefs.current[part];
    if (previous !== null) view.clearTimeout(previous);
    scrollEndFallbackRefs.current[part] = view.setTimeout(() => {
      scrollEndFallbackRefs.current[part] = null;
      handleScrollEnd(part);
    }, isCompactWheel ? 450 : SCROLL_END_FALLBACK_MS);
  };

  const handleScroll = (
    part: ThreeColumnPickerPart,
    event: UIEvent<HTMLDivElement>,
  ) => {
    if (!openedRef.current) return;

    const top = event.currentTarget.scrollTop;
    positionedPartsRef.current.add(part);
    const column = columns[part];
    if (isCompactWheel) {
      const index = Math.max(0, Math.min(column.values.length - 1, Math.round(top / geometry.rowHeight)));
      if (lastTickIndexRef.current[part] !== undefined && lastTickIndexRef.current[part] !== index) {
        // One selection tick per observed crossing; skipped native frames
        // must not produce a burst of haptic notifications.
        triggerTelegramPickerSelectionTick();
      }
      lastTickIndexRef.current[part] = index;
    }
    scrollingPartsRef.current.add(part);
    if (isCompactWheel && initialSyncFrameRef.current !== null) {
      (event.currentTarget.ownerDocument.defaultView ?? window).cancelAnimationFrame(initialSyncFrameRef.current);
      initialSyncFrameRef.current = null;
    }
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
      commitIndex(part, Math.round(nextTop / geometry.rowHeight));
    });
  };

  const handleSelect = (part: ThreeColumnPickerPart, index: number, event: MouseEvent<HTMLButtonElement>) => {
    if (!openedRef.current) return;

    if (isCompactWheel && suppressTouchClickRef.current[part] && event.detail > 0) return;
    if (isCompactWheel) {
      delete settlingRef.current[part];
      const view = target?.ownerDocument.defaultView ?? window;
      view.clearTimeout(settleTimersRef.current[part]);
      delete settleTimersRef.current[part];
      lastTickIndexRef.current[part] = index;
    }

    commitIndex(part, index);
    const nextTop = index * geometry.rowHeight;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [part]: nextTop }));
    const element = columnRefs.current[part];
    scrollColumn(element, index, geometry);
    if (element) positionedPartsRef.current.add(part);
    if (element) scheduleScrollEndFallback(part, element);
  };

  const flushWheels = () => {
    PARTS.forEach((part) => {
      // A freshly mounted mode may close before its opening RAF positioned
      // the wheels. Its browser-default scrollTop=0 is not an entered value.
      if (staticLens?.[part] || !positionedPartsRef.current.has(part)) return;
      const element = columnRefs.current[part];
      if (!element) return;
      commitIndex(part, Math.round(element.scrollTop / geometry.rowHeight));
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
      className={`ui-time-picker__popover${isCompactWheel ? ' ui-time-picker__popover--compact-time' : ''}${popoverClassName ? ` ${popoverClassName}` : ''}`}
      style={{ width: isCompactWheel ? '270px' : '336px', maxWidth: 'calc(100vw - 24px)' }}
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
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                setColumnRef={setColumnRef}
              />
            ))}
          </div>
          <PickerLens
            assets={lensAssets}
            geometry={geometry}
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
