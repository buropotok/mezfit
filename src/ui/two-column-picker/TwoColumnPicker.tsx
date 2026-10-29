import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type MouseEvent,
  type TouchEvent,
  type UIEvent,
} from 'react';
import { MezfitPopover } from '../konsta-mezfit';
import { centeredLensScale } from '../time-picker/centeredLensScale';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import {
  resolveTwoColumnPickerLensMode,
  type ResolvedTwoColumnPickerLensMode,
  type TwoColumnPickerLensMode,
} from './lensMode';
import '../time-picker/time-picker.css';

const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;

// The 72px optical source is scaled to 24px on screen for the compact time wheel.
interface WheelGeometry {
  rowHeight: number;
  circularCopies: number;
  lensScaleY: number;
  glyphScaleY: number;
}
const STANDARD_GEOMETRY: WheelGeometry = {
  rowHeight: 48, circularCopies: 3, lensScaleY: 1, glyphScaleY: 1,
};
const COMPACT_TIME_GEOMETRY: WheelGeometry = {
  rowHeight: 24, circularCopies: 5, lensScaleY: 1 / 3, glyphScaleY: 2,
};
const LENS_SOURCE_VERTICAL_INSET = 8;
const IOS_LENS_MAGNIFICATION = 1.55;
// The wheel reserves 2.5rem for its center separator; column centers
// on a 288px track are 62px and 226px, not 72px and 216px.
const LENS_COLUMN_XS = [62, 226] as const;
const UNIT_OFFSET_X = 36;

export type TwoColumnPickerSide = 'left' | 'right';

export interface TwoColumnPickerParts {
  left: number;
  right: number;
}

export interface TwoColumnPickerColumn {
  ariaLabel: string;
  values: readonly number[];
  format: (value: number) => string;
  formatAria?: (value: number) => string;
  fixedUnit?: string;
  circular?: boolean;
}

export interface TwoColumnPickerProps {
  opened: boolean;
  value: TwoColumnPickerParts;
  onChange: (value: TwoColumnPickerParts) => void;
  onClose: () => void;
  target: HTMLElement | null;
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn];
  ariaLabel: string;
  separator?: string;
  lensMode?: TwoColumnPickerLensMode;
  geometry?: 'standard' | 'compact-time';
}

type ScrollTops = TwoColumnPickerParts;

function valueIndex(column: TwoColumnPickerColumn, value: number) {
  const index = column.values.indexOf(value);
  if (index < 0) throw new Error(`TwoColumnPicker value ${value} is not present in its column`);
  return index;
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length;
}

function wheelIndex(column: TwoColumnPickerColumn, index: number, geometry: WheelGeometry) {
  return index + (column.circular ? column.values.length * Math.floor(geometry.circularCopies / 2) : 0);
}

function renderedLength(column: TwoColumnPickerColumn, geometry: WheelGeometry) {
  return column.values.length * (column.circular ? geometry.circularCopies : 1);
}

function wheelValue(column: TwoColumnPickerColumn, index: number) {
  const resolved = column.circular ? wrapIndex(index, column.values.length)
    : Math.max(0, Math.min(index, column.values.length - 1));
  return column.values[resolved];
}

function partsToScrollTops(
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn],
  parts: TwoColumnPickerParts,
  geometry: WheelGeometry,
): ScrollTops {
  return {
    left: wheelIndex(columns[0], valueIndex(columns[0], parts.left), geometry) * geometry.rowHeight,
    right: wheelIndex(columns[1], valueIndex(columns[1], parts.right), geometry) * geometry.rowHeight,
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

function visibleLensItems(
  column: TwoColumnPickerColumn,
  scrollTop: number,
  geometry: WheelGeometry,
) {
  const centerIndex = Math.round(scrollTop / geometry.rowHeight);
  const start = Math.max(0, centerIndex - 1);
  const end = Math.min(renderedLength(column, geometry) - 1, centerIndex + 1);

  return Array.from({ length: end - start + 1 }, (_, localIndex) => {
    const index = start + localIndex;
    const value = wheelValue(column, index);
    const globalCenter = WHEEL_HEIGHT / 2 + index * geometry.rowHeight - scrollTop;

    return {
      index,
      value,
      // Reverse the lens's vertical scale so adjacent 24px rows stay
      // 24px apart on screen and cannot intrude into the center lens.
      y: LENS_HEIGHT / 2 + (globalCenter - WHEEL_HEIGHT / 2) / geometry.lensScaleY,
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
  geometry,
}: {
  x: number;
  column: TwoColumnPickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
  geometry: WheelGeometry;
}) {
  return (
    <>
      {visibleLensItems(column, scrollTop, geometry).map(({ index, value, y }) => {
        const scale = lensMode === 'ios' ? iosLensScale(y) : 1;
        // Preserve legibility: an extra source-space vertical scale keeps the
        // selected glyph near 20px tall after the complete lens is compressed.
        const transform = geometry.glyphScaleY !== 1
          ? `translate(${x} ${y}) scale(${scale} ${scale * geometry.glyphScaleY}) translate(${-x} ${-y})`
          : lensMode === 'ios' && scale !== 1 ? centeredLensScale(x, y, scale) : undefined;

        return (
          <text
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

function PickerLens({
  assets,
  scrollTops,
  columns,
  separator,
  lensMode,
  geometry,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn];
  separator?: string;
  lensMode: ResolvedTwoColumnPickerLensMode;
  geometry: WheelGeometry;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-time-picker-lens-${reactId}`;
  const clipId = `ui-time-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-time-picker-lens-source-clip-${reactId}`;
  const separatorTransform = lensMode === 'ios'
    ? centeredLensScale(LENS_WIDTH / 2, LENS_HEIGHT / 2, IOS_LENS_MAGNIFICATION)
    : undefined;

  // Fixed units are composited after the displacement filter so they never
  // shift optically or scroll with any numeric ribbon.
  const fixedUnitLabels = (
    <>
      {columns.map((column, index) => column.fixedUnit ? (
        <text
          key={column.ariaLabel}
          x={LENS_COLUMN_XS[index] + UNIT_OFFSET_X}
          y={LENS_HEIGHT / 2}
          textAnchor="start"
          dominantBaseline="central"
          className="ui-time-picker__lens-unit ui-text--footnote"
        >
          {column.fixedUnit}
        </text>
      ) : null)}
    </>
  );

  const lensContent = (
    <>
      <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
      <LensText
        x={LENS_COLUMN_XS[0]}
        column={columns[0]}
        scrollTop={scrollTops.left}
        lensMode={lensMode}
        geometry={geometry}
      />
      {separator ? (
        <text
          x={LENS_WIDTH * 0.5}
          y={LENS_HEIGHT / 2}
          transform={separatorTransform}
          textAnchor="middle"
          dominantBaseline="central"
          className="ui-time-picker__lens-separator ui-text--title"
        >
          {separator}
        </text>
      ) : null}
      <LensText
        x={LENS_COLUMN_XS[1]}
        column={columns[1]}
        scrollTop={scrollTops.right}
        lensMode={lensMode}
        geometry={geometry}
      />
    </>
  );

  return (
    <div
      className="ui-time-picker__lens"
      data-ui-time-picker-lens-mode={lensMode}
      aria-hidden="true"
    >
      <svg
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
          <g clipPath={`url(#${clipId})`}>{lensContent}{fixedUnitLabels}</g>
        ) : (
          <g clipPath={`url(#${clipId})`}>
            <g filter={assets ? `url(#${filterId})` : undefined}>
              <g clipPath={`url(#${sourceClipId})`}>{lensContent}</g>
            </g>
            {fixedUnitLabels}
          </g>
        )}
      </svg>
    </div>
  );
}

function PickerColumnWheel({
  side,
  column,
  selected,
  onScroll,
  onSelect,
  onScrollEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  columnRef,
  geometry,
}: {
  side: TwoColumnPickerSide;
  column: TwoColumnPickerColumn;
  selected: number;
  onScroll: (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => void;
  onSelect: (side: TwoColumnPickerSide, index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onScrollEnd: (side: TwoColumnPickerSide) => void;
  onTouchStart: (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (side: TwoColumnPickerSide) => void;
  onTouchCancel: (side: TwoColumnPickerSide) => void;
  columnRef: RefObject<HTMLDivElement | null>;
  geometry: WheelGeometry;
}) {
  return (
    <div
      ref={columnRef}
      className="ui-time-picker__column"
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(side, event)}
      onScrollEnd={() => onScrollEnd(side)}
      onTouchStart={(event) => onTouchStart(side, event)}
      onTouchMove={(event) => onTouchMove(side, event)}
      onTouchEnd={() => onTouchEnd(side)}
      onTouchCancel={() => onTouchCancel(side)}
    >
      {Array.from({ length: renderedLength(column, geometry) }, (_, index) => {
        const value = wheelValue(column, index);
        const middleStart = column.values.length * Math.floor(geometry.circularCopies / 2);
        const duplicate = Boolean(column.circular && (index < middleStart || index >= middleStart + column.values.length));
        const isSelected = value === selected;
        const label = column.format(value);

        return (
          <button
            key={index}
            type="button"
            className={`ui-time-picker__option ui-text--body${isSelected ? ' ui-time-picker__option--selected' : ''}`}
            role={duplicate ? undefined : 'option'}
            aria-hidden={duplicate || undefined}
            tabIndex={duplicate ? -1 : 0}
            aria-label={duplicate ? undefined : column.formatAria?.(value) ?? label}
            aria-selected={duplicate ? undefined : isSelected}
            onClick={(event) => onSelect(side, index, event)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function TwoColumnPicker({
  opened,
  value,
  onChange,
  onClose,
  target,
  columns,
  ariaLabel,
  separator,
  lensMode = 'auto',
  geometry: geometryName = 'standard',
}: TwoColumnPickerProps) {
  const geometry = geometryName === 'compact-time' ? COMPACT_TIME_GEOMETRY : STANDARD_GEOMETRY;
  valueIndex(columns[0], value.left);
  valueIndex(columns[1], value.right);
  const resolvedLensMode = resolveTwoColumnPickerLensMode(lensMode);

  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<TwoColumnPickerParts>(value);
  const controlledRef = useRef<TwoColumnPickerParts>(value);
  const onChangeRef = useRef(onChange);
  const openedRef = useRef(opened);
  const wasOpenedRef = useRef(false);
  const leftFrameRef = useRef<number | null>(null);
  const rightFrameRef = useRef<number | null>(null);
  const reconcileFrameRef = useRef<number | null>(null);
  const initialSyncFrameRef = useRef<number | null>(null);
  const touchStartRef = useRef<Partial<Record<TwoColumnPickerSide, number>>>({});
  const suppressTouchClickRef = useRef<Partial<Record<TwoColumnPickerSide, boolean>>>({});
  const touchEpochRef = useRef(0);
  const deferredExternalRef = useRef<TwoColumnPickerParts | null>(null);
  const scrollingRef = useRef(new Set<TwoColumnPickerSide>());
  const locallyEmittedRef = useRef(new Set<string>());
  const endTimersRef = useRef<Partial<Record<TwoColumnPickerSide, number>>>({});
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, value, geometry));

  const [draft, setDraft] = useState<TwoColumnPickerParts>(value);
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = value;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  useEffect(() => {
    if (resolvedLensMode !== 'displacement' || !opened || lensAssets) return undefined;

    const documentRef = target?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!documentRef) return undefined;

    let cancelled = false;
    const view = documentRef.defaultView;
    const build = () => {
      if (!cancelled) setLensAssets(buildTimeLensAssets(documentRef, LENS_COLUMN_XS));
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
  }, [lensAssets, opened, resolvedLensMode, target]);

  useEffect(() => {
    const view = target?.ownerDocument.defaultView ?? window;

    if (!opened) {
      wasOpenedRef.current = false;
      scrollingRef.current.clear();
      locallyEmittedRef.current.clear();
      touchStartRef.current = {};
      suppressTouchClickRef.current = {};
      deferredExternalRef.current = null;
      if (initialSyncFrameRef.current !== null) {
        view.cancelAnimationFrame(initialSyncFrameRef.current);
        initialSyncFrameRef.current = null;
      }
      Object.values(endTimersRef.current).forEach(timer => view.clearTimeout(timer));
      endTimersRef.current = {};

      if (reconcileFrameRef.current !== null) {
        view.cancelAnimationFrame(reconcileFrameRef.current);
        reconcileFrameRef.current = null;
      }
      if (leftFrameRef.current !== null) {
        view.cancelAnimationFrame(leftFrameRef.current);
        leftFrameRef.current = null;
      }
      if (rightFrameRef.current !== null) {
        view.cancelAnimationFrame(rightFrameRef.current);
        rightFrameRef.current = null;
      }
      return;
    }

    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    const currentDraft = draftRef.current;
    const valueChanged = currentDraft.left !== value.left || currentDraft.right !== value.right;
    if (!justOpened && (!valueChanged || locallyEmittedRef.current.has(`${value.left}:${value.right}`))) {
      deferredExternalRef.current = null;
      return;
    }
    if (!justOpened && columns.some(column => column.circular)
      && (scrollingRef.current.size > 0 || Object.keys(touchStartRef.current).length > 0)) {
      // An external change must not snap a circular wheel while native momentum owns it.
      deferredExternalRef.current = value;
      return;
    }
    deferredExternalRef.current = null;
    locallyEmittedRef.current.clear();
    scrollingRef.current.clear();

    if (leftFrameRef.current !== null) {
      view.cancelAnimationFrame(leftFrameRef.current);
      leftFrameRef.current = null;
    }
    if (rightFrameRef.current !== null) {
      view.cancelAnimationFrame(rightFrameRef.current);
      rightFrameRef.current = null;
    }

    draftRef.current = value;
    setDraft(value);
    const nextScrollTops = partsToScrollTops(columns, value, geometry);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    if (initialSyncFrameRef.current !== null) view.cancelAnimationFrame(initialSyncFrameRef.current);
    initialSyncFrameRef.current = view.requestAnimationFrame(() => {
      initialSyncFrameRef.current = null;
      if (!openedRef.current || (columns.some(column => column.circular) && scrollingRef.current.size > 0)) return;
      scrollColumn(leftRef.current, wheelIndex(columns[0], valueIndex(columns[0], value.left), geometry), geometry);
      scrollColumn(rightRef.current, wheelIndex(columns[1], valueIndex(columns[1], value.right), geometry), geometry);
    });
  }, [columns, opened, target, value.left, value.right]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
    Object.values(endTimersRef.current).forEach(timer => view.clearTimeout(timer));
    if (initialSyncFrameRef.current !== null) view.cancelAnimationFrame(initialSyncFrameRef.current);
    if (leftFrameRef.current !== null) view.cancelAnimationFrame(leftFrameRef.current);
    if (rightFrameRef.current !== null) view.cancelAnimationFrame(rightFrameRef.current);
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
  }, [target]);

  const commitIndex = (side: TwoColumnPickerSide, index: number) => {
    const column = side === 'left' ? columns[0] : columns[1];
    const nextValue = wheelValue(column, index);
    const current = draftRef.current;
    const next = side === 'left'
      ? { ...current, left: nextValue }
      : { ...current, right: nextValue };

    if (next.left === current.left && next.right === current.right) {
      draftRef.current = current;
      setDraft(current);
      return;
    }

    draftRef.current = next;
    setDraft(next);
    locallyEmittedRef.current.add(`${next.left}:${next.right}`);
    onChangeRef.current(next);
  };

  // A circular wheel may move only on real scrollend or a new touch, which
  // interrupts native momentum. A WebView scroll-event gap is not a stop.
  const recenterCircularColumn = (side: TwoColumnPickerSide) => {
    const column = columns[side === 'left' ? 0 : 1];
    const element = side === 'left' ? leftRef.current : rightRef.current;
    if (!column.circular || !element) return;
    const row = Math.round(element.scrollTop / geometry.rowHeight);
    const middle = column.values.length * Math.floor(geometry.circularCopies / 2);
    if (row >= middle && row < middle + column.values.length) return;
    const index = wheelIndex(column, wrapIndex(row, column.values.length), geometry);
    const top = index * geometry.rowHeight;
    pendingScrollRef.current = { ...pendingScrollRef.current, [side]: top };
    setScrollTops(current => ({ ...current, [side]: top }));
    scrollColumn(element, index, geometry);
  };

  const handleTouchStart = (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => {
    const column = columns[side === 'left' ? 0 : 1];
    if (!column.circular) return;
    touchEpochRef.current += 1;
    suppressTouchClickRef.current[side] = false;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    if (initialSyncFrameRef.current !== null) {
      view.cancelAnimationFrame(initialSyncFrameRef.current);
      initialSyncFrameRef.current = null;
    }
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
    // The new touch interrupts the preceding native scroll even on WebViews
    // without scrollend. Restore the middle cycle before this gesture moves.
    scrollingRef.current.delete(side);
    recenterCircularColumn(side);
    const touch = event.touches[0];
    if (touch) touchStartRef.current[side] = touch.clientY;
  };

  const handleTouchMove = (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartRef.current[side];
    const touch = event.touches[0];
    if (startY !== undefined && touch && Math.abs(touch.clientY - startY) > 8) {
      suppressTouchClickRef.current[side] = true;
    }
  };

  const handleTouchEnd = (side: TwoColumnPickerSide) => {
    delete touchStartRef.current[side];
  };

  const handleTouchCancel = (side: TwoColumnPickerSide) => {
    if (touchStartRef.current[side] !== undefined) suppressTouchClickRef.current[side] = true;
    delete touchStartRef.current[side];
  };

  // Reconcile only after native momentum finishes; never write scrollTop per frame.
  const handleScrollEnd = (side: TwoColumnPickerSide) => {
    if (!openedRef.current) return;
    const view = target?.ownerDocument.defaultView ?? window;
    view.clearTimeout(endTimersRef.current[side]);
    delete endTimersRef.current[side];
    const element = side === 'left' ? leftRef.current : rightRef.current;
    if (!element) return;
    commitIndex(side, Math.round(element.scrollTop / geometry.rowHeight));
    scrollingRef.current.delete(side);
    if (scrollingRef.current.size > 0) return;
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
    const epoch = touchEpochRef.current;
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current || scrollingRef.current.size > 0 || touchEpochRef.current !== epoch
        || Object.keys(touchStartRef.current).length > 0) return;
      const deferred = deferredExternalRef.current;
      deferredExternalRef.current = null;
      if (deferred && !locallyEmittedRef.current.has(`${deferred.left}:${deferred.right}`)) {
        draftRef.current = deferred;
        setDraft(deferred);
        const tops = partsToScrollTops(columns, deferred, geometry);
        pendingScrollRef.current = tops;
        setScrollTops(tops);
        scrollColumn(leftRef.current, wheelIndex(columns[0], valueIndex(columns[0], deferred.left), geometry), geometry);
        scrollColumn(rightRef.current, wheelIndex(columns[1], valueIndex(columns[1], deferred.right), geometry), geometry);
        locallyEmittedRef.current.clear();
        return;
      }
      const canonical = controlledRef.current;
      const circular = columns[0].circular || columns[1].circular;
      if (!circular && (canonical.left !== draftRef.current.left || canonical.right !== draftRef.current.right)) {
        draftRef.current = canonical;
        setDraft(canonical);
        const tops = partsToScrollTops(columns, canonical, geometry);
        pendingScrollRef.current = tops;
        setScrollTops(tops);
        scrollColumn(leftRef.current, valueIndex(columns[0], canonical.left), geometry);
        scrollColumn(rightRef.current, valueIndex(columns[1], canonical.right), geometry);
      } else {
        // Recenter identical cycles only after confirmed native scrollend.
        (['left', 'right'] as const).forEach(recenterCircularColumn);
      }
      locallyEmittedRef.current.clear();
    });
  };

  const handleScroll = (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => {
    if (!openedRef.current) return;

    const element = event.currentTarget;
    const column = columns[side === 'left' ? 0 : 1];
    const top = element.scrollTop;
    const view = element.ownerDocument.defaultView ?? window;
    scrollingRef.current.add(side);
    if (initialSyncFrameRef.current !== null && columns.some(column => column.circular)) {
      view.cancelAnimationFrame(initialSyncFrameRef.current);
      initialSyncFrameRef.current = null;
    }
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }
    // For circular TimePicker wheels an inactivity timer cannot establish that
    // momentum ended. Wait for native scrollend or the user's next touch.
    if (!column.circular && typeof (element as HTMLDivElement & { onscrollend?: unknown }).onscrollend === 'undefined') {
      view.clearTimeout(endTimersRef.current[side]);
      endTimersRef.current[side] = view.setTimeout(() => handleScrollEnd(side), 200);
    }
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [side]: top,
    };

    const frameRef = side === 'left' ? leftFrameRef : rightFrameRef;
    if (frameRef.current !== null) return;

    frameRef.current = view.requestAnimationFrame(() => {
      frameRef.current = null;
      if (!openedRef.current) return;

      const nextTop = pendingScrollRef.current[side];
      setScrollTops((current) => ({ ...current, [side]: nextTop }));
      commitIndex(side, Math.round(nextTop / geometry.rowHeight));
    });
  };

  const handleSelect = (side: TwoColumnPickerSide, index: number, event: MouseEvent<HTMLButtonElement>) => {
    if (!openedRef.current) return;
    const column = columns[side === 'left' ? 0 : 1];
    // An occasional synthetic click after a touch flick must not cancel inertia.
    if (column.circular && suppressTouchClickRef.current[side] && event.detail > 0) return;

    commitIndex(side, index);
    const nextIndex = column.circular ? wheelIndex(column, index % column.values.length, geometry) : index;
    const nextTop = nextIndex * geometry.rowHeight;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [side]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [side]: nextTop }));
    scrollColumn(side === 'left' ? leftRef.current : rightRef.current, nextIndex, geometry);
  };

  const handleClose = () => {
    // Flush both actual native positions, including a scroll not yet painted by RAF.
    (['left', 'right'] as const).forEach(side => {
      const element = side === 'left' ? leftRef.current : rightRef.current;
      if (element) commitIndex(side, Math.round(element.scrollTop / geometry.rowHeight));
    });
    onClose();
  };

  return (
    <MezfitPopover
      opened={opened}
      target={target ?? undefined}
      angle={false}
      viewportTop={100}
      scrollable
      portal={typeof document !== 'undefined' ? document.getElementById('root') ?? true : false}
      backdrop
      iosHighlight={false}
      onBackdropClick={handleClose}
      className={geometryName === 'compact-time'
        ? 'ui-time-picker__popover ui-time-picker__popover--compact-time'
        : 'ui-time-picker__popover'}
      style={{ width: '336px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {opened ? <div className="ui-time-picker">
        <div className="ui-time-picker__wheel">
          <div className="ui-time-picker__columns">
            <PickerColumnWheel
              side="left"
              column={columns[0]}
              selected={draft.left}
              onScroll={handleScroll}
              onSelect={handleSelect}
              onScrollEnd={handleScrollEnd}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
              columnRef={leftRef}
              geometry={geometry}
            />
            <span className="ui-time-picker__separator ui-text--title" aria-hidden="true">
              {separator ?? ''}
            </span>
            <PickerColumnWheel
              side="right"
              column={columns[1]}
              selected={draft.right}
              onScroll={handleScroll}
              onSelect={handleSelect}
              onScrollEnd={handleScrollEnd}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
              columnRef={rightRef}
              geometry={geometry}
            />
          </div>

          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            columns={columns}
            separator={separator}
            lensMode={resolvedLensMode}
            geometry={geometry}
          />
        </div>
      </div> : null}
    </MezfitPopover>
  );
}
