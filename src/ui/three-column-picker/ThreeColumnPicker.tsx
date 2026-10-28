import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
  type TouchEvent,
  type ReactNode,
} from 'react';
import { triggerTelegramSelectionHaptic } from '../../telegram';
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
  freeMomentum?: boolean;
  /** Fast-flick native snap interval, matching TwoColumnPicker. */
  flickSnapStep?: number;
  /** After fast-swipe detection, each physical row represents N values relative
   * to the value where the gesture began (e.g. 23, 33, 43). */
  relativeFlickStep?: number;
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
}: {
  x: number;
  column: ThreeColumnPickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
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
  lensMode,
  columns,
  lensXs,
  separators = [],
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  lensMode: ResolvedTwoColumnPickerLensMode;
  columns: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>;
  lensXs: readonly [number, number, number];
  separators?: readonly ThreeColumnPickerSeparator[];
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-three-column-picker-lens-${reactId}`;
  const clipId = `ui-three-column-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-three-column-picker-lens-source-clip-${reactId}`;
  const lensContent = (
    <>
      <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
      {PARTS.map((part, index) => (
        <LensText
          key={part}
          x={lensXs[index]}
          column={columns[part]}
          scrollTop={scrollTops[part]}
          lensMode={lensMode}
        />
      ))}
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
          <g clipPath={`url(#${clipId})`}>{lensContent}</g>
        ) : (
          <g clipPath={`url(#${clipId})`}>
            <g filter={assets ? `url(#${filterId})` : undefined}>
              <g clipPath={`url(#${sourceClipId})`}>{lensContent}</g>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

function relativeFlickColumn(
  column: ThreeColumnPickerColumn,
  origin: number,
): ThreeColumnPickerColumn {
  const step = column.relativeFlickStep;
  if (!step) return column;
  const remainder = origin % step;
  return {
    ...column,
    values: column.values.filter((_value, index) => index % step === remainder),
    // Every rendered row is already one full N-unit value step.
    flickSnapStep: 1,
  };
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
  quarterSnap,
  setColumnRef,
}: {
  part: ThreeColumnPickerPart;
  column: ThreeColumnPickerColumn;
  selected: number;
  onScroll: (part: ThreeColumnPickerPart, event: UIEvent<HTMLDivElement>) => void;
  onScrollEnd: (part: ThreeColumnPickerPart) => void;
  onSelect: (part: ThreeColumnPickerPart, index: number) => void;
  onTouchStart: (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => void;
  onTouchCancel: (part: ThreeColumnPickerPart) => void;
  quarterSnap: boolean;
  setColumnRef: (part: ThreeColumnPickerPart, element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(element) => setColumnRef(part, element)}
      className={`ui-time-picker__column${column.freeMomentum ? ' ui-time-picker__column--free-momentum' : ''}${quarterSnap ? ' ui-time-picker__column--quarter-snap' : ''}`}
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(part, event)}
      onScrollEnd={() => onScrollEnd(part)}
      onTouchStart={(event) => onTouchStart(part, event)}
      onTouchMove={(event) => onTouchMove(part, event)}
      onTouchEnd={(event) => onTouchEnd(part, event)}
      onTouchCancel={() => onTouchCancel(part)}
    >
      {column.values.map((value, index) => {
        const isSelected = value === selected;
        const quarterStop = Boolean(column.flickSnapStep && index % column.flickSnapStep === 0);
        const label = column.format(value);

        return (
          <button
            key={value}
            type="button"
            className={`ui-time-picker__option ui-text--body${isSelected ? ' ui-time-picker__option--selected' : ''}${quarterStop ? ' ui-time-picker__option--quarter-stop' : ''}`}
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
  const touchStartRef = useRef<Partial<Record<ThreeColumnPickerPart, {
    y: number;
    time: number;
    index: number;
  }>>>({});
  const relativeFlickOriginRef = useRef<Record<ThreeColumnPickerPart, number>>({
    first: 0, second: 0, third: 0,
  });
  const externalResetValueRef = useRef<Partial<Record<ThreeColumnPickerPart, number>>>({});
  const quarterSnapRef = useRef<Record<ThreeColumnPickerPart, boolean>>({
    first: false, second: false, third: false,
  });
  const [quarterSnap, setQuarterSnap] = useState<Record<ThreeColumnPickerPart, boolean>>({
    first: false, second: false, third: false,
  });
  // Parent acknowledgements can arrive after further native scroll frames.
  const locallyEmittedRef = useRef<Set<string>>(new Set());
  const scrollingPartsRef = useRef<Set<ThreeColumnPickerPart>>(new Set());
  const scrollEndFallbackRefs = useRef<Record<ThreeColumnPickerPart, number | null>>({
    first: null,
    second: null,
    third: null,
  });
  const feedbackValueRef = useRef<ThreeColumnPickerParts>(valueParts);
  const [draft, setDraft] = useState<ThreeColumnPickerParts>(valueParts);
  const wheelColumns = useMemo<Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>>(() => ({
    first: quarterSnap.first && columns.first.relativeFlickStep
      ? relativeFlickColumn(columns.first, relativeFlickOriginRef.current.first) : columns.first,
    second: quarterSnap.second && columns.second.relativeFlickStep
      ? relativeFlickColumn(columns.second, relativeFlickOriginRef.current.second) : columns.second,
    third: quarterSnap.third && columns.third.relativeFlickStep
      ? relativeFlickColumn(columns.third, relativeFlickOriginRef.current.third) : columns.third,
  }), [columns, quarterSnap.first, quarterSnap.second, quarterSnap.third]);
  const previousWheelColumnsRef = useRef(wheelColumns);
  const wheelColumnsRef = useRef(wheelColumns);
  wheelColumnsRef.current = wheelColumns;
  // useRef's initializer expression is evaluated on *every* render.
  // Always use the full validated values: an external controlled update may
  // temporarily have a different remainder from active coarse rows.
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
      const index = wheelColumnsRef.current[part].values.indexOf(parts[part]);
      if (index >= 0) scrollColumn(columnRefs.current[part], index);
    });
  };

  // On a fast flick, remap the current physical row to a row representing
  // ten kilograms, retaining finger travel measured in rows. Do this once
  // when the mode changes; native WebView pan and momentum own subsequent
  // scrolling. Reversing the mode on the *next touch* restores 1kg rows.
  useLayoutEffect(() => {
    const previous = previousWheelColumnsRef.current;
    previousWheelColumnsRef.current = wheelColumns;
    if (!opened) return;
    PARTS.forEach((part) => {
      if (previous[part] === wheelColumns[part]) return;
      const oldColumn = previous[part];
      const newColumn = wheelColumns[part];
      const element = columnRefs.current[part];
      if (!element) return;
      const view = element.ownerDocument.defaultView ?? window;
      const oldRow = element.scrollTop / ROW_HEIGHT;
      let nextRow: number;
      if (quarterSnapRef.current[part] && columns[part].relativeFlickStep) {
        const origin = relativeFlickOriginRef.current[part];
        const anchorValue = columns[part].values[origin];
        const anchorRow = newColumn.values.indexOf(anchorValue);
        nextRow = anchorRow + oldRow - origin;
      } else {
        const externallySelected = externalResetValueRef.current[part];
        delete externalResetValueRef.current[part];
        const oldIndex = Math.max(0, Math.min(oldColumn.values.length - 1, Math.round(oldRow)));
        const currentValue = externallySelected ?? oldColumn.values[oldIndex];
        const fullIndex = newColumn.values.indexOf(currentValue);
        nextRow = fullIndex >= 0 ? fullIndex : valueIndex(newColumn, draftRef.current[part]);
      }
      const boundedRow = Math.max(0, Math.min(newColumn.values.length - 1, nextRow));
      const nextIndex = Math.round(boundedRow);
      const nextValue = newColumn.values[nextIndex];
      // Retain sub-row finger travel at the mode boundary; only the row
      // semantics change. Native scrolling continues with its own velocity.
      const top = boundedRow * ROW_HEIGHT;
      // A delayed scroll RAF from the previous row set must not interpret
      // the new scrollTop using the previous column's semantics.
      if (frameRefs.current[part] !== null) {
        view.cancelAnimationFrame(frameRefs.current[part]!);
        frameRefs.current[part] = null;
      }
      const fallback = scrollEndFallbackRefs.current[part];
      if (fallback !== null) {
        view.clearTimeout(fallback);
        scrollEndFallbackRefs.current[part] = null;
      }
      feedbackValueRef.current = { ...feedbackValueRef.current, [part]: nextValue };
      pendingScrollRef.current = { ...pendingScrollRef.current, [part]: top };
      setScrollTops((current) => ({ ...current, [part]: top }));
      if (draftRef.current[part] !== nextValue) {
        const next = { ...draftRef.current, [part]: nextValue };
        draftRef.current = next;
        setDraft(next);
        locallyEmittedRef.current.add(partsKey(next));
        onChangeRef.current(next);
        triggerTelegramSelectionHaptic();
      }
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top, behavior: 'auto' });
      } else {
        element.scrollTop = top;
      }
    });
  }, [columns, opened, wheelColumns]);

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
      touchStartRef.current = {};
      externalResetValueRef.current = {};
      quarterSnapRef.current = { first: false, second: false, third: false };
      setQuarterSnap(quarterSnapRef.current);
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
    touchStartRef.current = {};
    draftRef.current = valueParts;
    feedbackValueRef.current = valueParts;
    setDraft(valueParts);
    // A new external value can have a different remainder than the active
    // coarse rows. Return to the full wheel before positioning that value.
    PARTS.forEach((part) => {
      if (quarterSnapRef.current[part] && columns[part].relativeFlickStep) {
        externalResetValueRef.current[part] = valueParts[part];
        setQuarterSnapMode(part, false);
      }
    });
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

  const signalCrossedValues = (part: ThreeColumnPickerPart, index: number, fromScroll: boolean) => {
    const column = wheelColumns[part];
    const values = column.values;
    const nextIndex = Math.max(0, Math.min(values.length - 1, index));
    const lastIndex = values.indexOf(feedbackValueRef.current[part]);
    if (lastIndex === nextIndex) return;

    // Scroll events may skip multiple rows: issue one tick per crossed value,
    // even if React commits only the most recent position this animation frame.
    if (fromScroll && !columns[part].flickSnapStep && !columns[part].relativeFlickStep) {
      const step = nextIndex > lastIndex ? 1 : -1;
      for (let cursor = lastIndex + step; cursor !== nextIndex + step; cursor += step) {
        triggerTelegramSelectionHaptic();
      }
    } else {
      // TimePicker triggers one selection haptic per reported change.
      triggerTelegramSelectionHaptic();
    }
    feedbackValueRef.current = { ...feedbackValueRef.current, [part]: values[nextIndex] };
  };

  const commitIndex = (part: ThreeColumnPickerPart, index: number) => {
    const column = wheelColumns[part];
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
    const column = wheelColumns[part];
    const index = Math.max(0, Math.min(column.values.length - 1, Math.round(element.scrollTop / ROW_HEIGHT)));
    signalCrossedValues(part, index, true);
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
        feedbackValueRef.current = canonical;
        setDraft(canonical);
        const activeColumns = wheelColumnsRef.current;
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
    signalCrossedValues(part, Math.round(top / ROW_HEIGHT), true);
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

  const setQuarterSnapMode = (part: ThreeColumnPickerPart, enabled: boolean) => {
    if (quarterSnapRef.current[part] === enabled) return;
    quarterSnapRef.current = { ...quarterSnapRef.current, [part]: enabled };
    setQuarterSnap(quarterSnapRef.current);
  };

  const handleTouchStart = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    // Commit the actual visible row before changing the row density.
    if (quarterSnapRef.current[part] && columns[part].relativeFlickStep) {
      const current = wheelColumns[part];
      const element = event.currentTarget;
      const visibleIndex = Math.max(0, Math.min(current.values.length - 1,
        Math.round(element.scrollTop / ROW_HEIGHT)));
      signalCrossedValues(part, visibleIndex, true);
      commitIndex(part, visibleIndex);
    }
    const initialIndex = valueIndex(columns[part], draftRef.current[part]);
    touchStartRef.current[part] = {
      y: touch.clientY, time: event.timeStamp, index: initialIndex,
    };
    setQuarterSnapMode(part, false);
  };

  const isFastSwipe = (part: ThreeColumnPickerPart, y: number, time: number) => {
    const start = touchStartRef.current[part];
    if (!start) return false;
    const distance = Math.abs(y - start.y);
    const duration = Math.max(1, time - start.time);
    return distance >= 36 && duration <= 500 && distance / duration >= 0.35;
  };

  const handleTouchMove = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const column = columns[part];
    const touch = event.touches[0];
    if (!(column.flickSnapStep || column.relativeFlickStep) || !touch) return;
    if (column.relativeFlickStep && isFastSwipe(part, touch.clientY, event.timeStamp)
      && !quarterSnapRef.current[part]) {
      relativeFlickOriginRef.current[part] = touchStartRef.current[part]?.index
        ?? valueIndex(columns[part], draftRef.current[part]);
    }
    // Keep TimePicker's fast-swipe detection and native momentum. Relative
    // columns switch physical rows to the gesture-origin 10-unit sequence.
    if (isFastSwipe(part, touch.clientY, event.timeStamp)) setQuarterSnapMode(part, true);
  };

  const handleTouchEnd = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const column = columns[part];
    const touch = event.changedTouches[0];
    const detectedFast = Boolean(touch && isFastSwipe(part, touch.clientY, event.timeStamp));
    if (column.relativeFlickStep && detectedFast && !quarterSnapRef.current[part]) {
      relativeFlickOriginRef.current[part] = touchStartRef.current[part]?.index
        ?? valueIndex(columns[part], draftRef.current[part]);
    }
    // A relative fast flick stays on its ten-unit rows until the next
    // independent touchstart; its native inertia must not revert mid-flight.
    setQuarterSnapMode(part, column.relativeFlickStep
      ? quarterSnapRef.current[part] || detectedFast
      : Boolean(column.flickSnapStep && detectedFast));
    delete touchStartRef.current[part];
  };

  const handleTouchCancel = (part: ThreeColumnPickerPart) => {
    delete touchStartRef.current[part];
    // Native WebView scrolling can take over a touch and emit touchcancel.
    // Keep the active snap targets through that same momentum gesture.
  };

  const handleSelect = (part: ThreeColumnPickerPart, index: number) => {
    if (!openedRef.current) return;

    delete touchStartRef.current[part];
    signalCrossedValues(part, index, false);
    commitIndex(part, index);
    if (quarterSnapRef.current[part] && columns[part].relativeFlickStep) {
      // The native location must represent the tapped row before the full
      // one-kilogram value set is restored in the layout effect.
      scrollColumn(columnRefs.current[part], index);
      setQuarterSnapMode(part, false);
      return;
    }
    setQuarterSnapMode(part, false);
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

  const handleClose = () => {
    // Match TimePicker: use the native visible position or the active coarse
    // snap target if the popover closes while inertia is still settling.
    PARTS.forEach((part) => {
      const column = columns[part];
      if (!(column.flickSnapStep || column.relativeFlickStep)) return;
      const element = columnRefs.current[part];
      if (!element) return;
      const index = Math.round(element.scrollTop / ROW_HEIGHT);
      const finalIndex = quarterSnapRef.current[part] && column.flickSnapStep
        ? Math.round(index / column.flickSnapStep) * column.flickSnapStep
        : index;
      commitIndex(part, finalIndex);
    });
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
      opened={opened}
      target={target ?? undefined}
      angle={false}
      backdrop
      iosHighlight={false}
      onBackdropClick={handleClose}
      className={`ui-time-picker__popover${popoverClassName ? ` ${popoverClassName}` : ''}`}
      style={{ width: '336px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className={`ui-time-picker${pickerClassName ? ` ${pickerClassName}` : ''}`}>
        {header}
        <div className="ui-time-picker__wheel">
          <div className={`ui-time-picker__columns${columnsClassName ? ` ${columnsClassName}` : ''}`}>
            {PARTS.map((part) => (
              <ThreeColumnPickerColumnWheel
                key={part}
                part={part}
                column={wheelColumns[part]}
                selected={draft[part]}
                onScroll={handleScroll}
                onScrollEnd={handleScrollEnd}
                onSelect={handleSelect}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                quarterSnap={quarterSnap[part]}
                setColumnRef={setColumnRef}
              />
            ))}
          </div>
          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            lensMode={resolvedLensMode}
            columns={wheelColumns}
            lensXs={lensXs}
            separators={separators}
          />
        </div>
      </div>
    </MezfitPopover>
  );
}
