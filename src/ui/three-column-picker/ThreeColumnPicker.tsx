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
// Native gesture wheel: each coarse row represents N original values.
// A stationary hold switches that same native scroller to one-value rows.
const HOLD_TO_FINE_MS = 240;
const SWIPE_THRESHOLD_PX = 20;
const UNAMBIGUOUS_SWIPE_PX = 64;

type NativeGesture = {
  startY: number;
  startTime: number;
  moved: boolean;
  holdTimer: number | null;
  mode: 'pending' | 'coarse' | 'fine';
};

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
  /** Native kinetic swipe: each row advances by N; a stationary hold selects one-unit rows. */
  gestureStep?: number;
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

function nativeGestureColumn(
  column: ThreeColumnPickerColumn,
  selected: number,
  fine: boolean,
): ThreeColumnPickerColumn {
  const step = column.gestureStep;
  if (!step || fine) return column;
  const selectedIndex = valueIndex(column, selected);
  const residue = selectedIndex % step;
  // Like TimePicker, each rendered row is a native scroll snap target.
  // The coarse row occupies 48px but represents a 10kg semantic step.
  return {
    ...column,
    values: column.values.filter((_value, index) => index % step === residue),
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
  setColumnRef: (part: ThreeColumnPickerPart, element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(element) => setColumnRef(part, element)}
      className={`ui-time-picker__column${column.freeMomentum ? ' ui-time-picker__column--free-momentum' : ''}${column.gestureStep ? ' ui-time-picker__column--gesture-scrub' : ''}`}
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(part, event)}
      onScrollEnd={() => onScrollEnd(part)}
      onTouchStart={(event) => onTouchStart(part, event)}
      onTouchMove={(event) => onTouchMove(part, event)}
      onTouchEnd={(event) => onTouchEnd(part, event)}
      onTouchCancel={() => onTouchCancel(part)}
      onContextMenu={(event) => {
        // Suppress WebView's button/text long-press callout for the gesture wheel.
        // A native context menu may cancel the touch sequence before fine drag.
        if (column.gestureStep) event.preventDefault();
      }}
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
  const gestureRef = useRef<Partial<Record<ThreeColumnPickerPart, NativeGesture>>>({});
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
  const [fineParts, setFineParts] = useState<Record<ThreeColumnPickerPart, boolean>>({
    first: false, second: false, third: false,
  });
  const finePartsRef = useRef(fineParts);
  // The selected value's residue stays fixed during a coarse swipe and
  // changes only after a fine adjustment or external controlled update.
  const residues = PARTS.map((part) => columns[part].gestureStep
    ? valueIndex(columns[part], draft[part]) % columns[part].gestureStep!
    : 0) as [number, number, number];
  const displayedColumns = useMemo<Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>>(() => ({
    first: nativeGestureColumn(columns.first, draft.first, fineParts.first),
    second: nativeGestureColumn(columns.second, draft.second, fineParts.second),
    third: nativeGestureColumn(columns.third, draft.third, fineParts.third),
  }), [columns, fineParts.first, fineParts.second, fineParts.third,
    residues[0], residues[1], residues[2]]);
  const previousDisplayedColumnsRef = useRef(displayedColumns);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(displayedColumns, valueParts));
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = valueParts;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  const cancelScheduledFrames = (view: Window) => {
    PARTS.forEach((part) => {
      const gesture = gestureRef.current[part];
      if (gesture?.holdTimer != null) view.clearTimeout(gesture.holdTimer);
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
      const index = displayedColumns[part].values.indexOf(parts[part]);
      if (index >= 0) scrollColumn(columnRefs.current[part], index);
    });
  };

  // Re-render only the native value rows when changing between coarse and
  // fine precision. This is the one position correction at a mode boundary;
  // the browser owns all scrolling and kinetic deceleration between boundaries.
  useLayoutEffect(() => {
    const previous = previousDisplayedColumnsRef.current;
    previousDisplayedColumnsRef.current = displayedColumns;
    if (!opened) return;
    PARTS.forEach((part) => {
      if (previous[part].values === displayedColumns[part].values) return;
      const index = displayedColumns[part].values.indexOf(draftRef.current[part]);
      if (index < 0) return; // The controlled value will update draft next render.
      const element = columnRefs.current[part];
      const view = element?.ownerDocument.defaultView ?? window;
      if (frameRefs.current[part] !== null) {
        view.cancelAnimationFrame(frameRefs.current[part]!);
        frameRefs.current[part] = null;
      }
      const timer = scrollEndFallbackRefs.current[part];
      if (timer !== null) {
        view.clearTimeout(timer);
        scrollEndFallbackRefs.current[part] = null;
      }
      const top = index * ROW_HEIGHT;
      pendingScrollRef.current = { ...pendingScrollRef.current, [part]: top };
      setScrollTops((current) => ({ ...current, [part]: top }));
      scrollColumn(element, index);
    });
  }, [displayedColumns, opened, target]);

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
      gestureRef.current = {};
      if (PARTS.some((part) => finePartsRef.current[part])) {
        finePartsRef.current = { first: false, second: false, third: false };
        setFineParts(finePartsRef.current);
      }
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
    gestureRef.current = {};
    draftRef.current = valueParts;
    feedbackValueRef.current = valueParts;
    setDraft(valueParts);
    // External controlled updates can change the coarse residue. Let draft
    // re-render its native row set before trying to find the new scroll index.
    if (!PARTS.every((part) => displayedColumns[part].values.includes(valueParts[part]))) return;
    const nextScrollTops = partsToScrollTops(displayedColumns, valueParts);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    view.requestAnimationFrame(() => {
      if (!openedRef.current) return;
      syncColumns(valueParts);
    });
  }, [opened, target, columns, displayedColumns, valueParts.first, valueParts.second, valueParts.third]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
    cancelScheduledFrames(view);
  }, [target]);

  const signalCrossedValues = (part: ThreeColumnPickerPart, index: number, fromScroll: boolean) => {
    const values = displayedColumns[part].values;
    const nextIndex = Math.max(0, Math.min(values.length - 1, index));
    const lastIndex = valueIndex(displayedColumns[part], feedbackValueRef.current[part]);
    if (lastIndex === nextIndex) return;

    // Scroll events may skip multiple rows: issue one tick per crossed value,
    // even if React commits only the most recent position this animation frame.
    if (fromScroll && !columns[part].gestureStep) {
      const step = nextIndex > lastIndex ? 1 : -1;
      for (let cursor = lastIndex + step; cursor !== nextIndex + step; cursor += step) {
        triggerTelegramSelectionHaptic();
      }
    } else {
      // TimePicker's native wheel emits one pulse for each reported change.
      // Never queue an entire skipped run of coarse rows in one WebView event.
      triggerTelegramSelectionHaptic();
    }
    feedbackValueRef.current = { ...feedbackValueRef.current, [part]: values[nextIndex] };
  };

  const commitIndex = (part: ThreeColumnPickerPart, index: number) => {
    const column = displayedColumns[part];
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
    const column = displayedColumns[part];
    const index = Math.max(0, Math.min(column.values.length - 1, Math.round(element.scrollTop / ROW_HEIGHT)));
    signalCrossedValues(part, index, true);
    commitIndex(part, index);
    if (columns[part].gestureStep && finePartsRef.current[part] && !gestureRef.current[part]) {
      setNativeFineMode(part, false);
    }
    if (scrollingPartsRef.current.size > 0) return;

    // Only reconcile a rejected controlled value after all wheels stop.
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current || scrollingPartsRef.current.size > 0
        || PARTS.some((candidate) => gestureRef.current[candidate])) return;
      const canonical = controlledRef.current;
      if (!partsEqual(draftRef.current, canonical)) {
        draftRef.current = canonical;
        feedbackValueRef.current = canonical;
        setDraft(canonical);
        if (PARTS.every((candidate) => displayedColumns[candidate].values.includes(canonical[candidate]))) {
          const tops = partsToScrollTops(displayedColumns, canonical);
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

  const setNativeFineMode = (part: ThreeColumnPickerPart, fine: boolean) => {
    if (finePartsRef.current[part] === fine) return;
    finePartsRef.current = { ...finePartsRef.current, [part]: fine };
    setFineParts(finePartsRef.current);
  };

  const handleTouchStart = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!columns[part].gestureStep || !touch || !openedRef.current) return;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    const previous = gestureRef.current[part];
    if (previous?.holdTimer !== null && previous?.holdTimer !== undefined) {
      view.clearTimeout(previous.holdTimer);
    }
    // A new gesture always starts in the native coarse wheel. The browser
    // cancels ongoing momentum on the next finger-down, as in TimePicker.
    setNativeFineMode(part, false);
    const gesture: NativeGesture = {
      startY: touch.clientY,
      startTime: event.timeStamp,
      moved: false,
      holdTimer: null,
      mode: 'pending',
    };
    gestureRef.current[part] = gesture;
    gesture.holdTimer = view.setTimeout(() => {
      gesture.holdTimer = null;
      if (gestureRef.current[part] !== gesture || gesture.mode !== 'pending') return;
      gesture.mode = 'fine';
      setNativeFineMode(part, true);
    }, HOLD_TO_FINE_MS);
  };

  const handleTouchMove = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current[part];
    const touch = event.touches[0];
    if (!columns[part].gestureStep || !gesture || !touch) return;
    const distance = Math.abs(gesture.startY - touch.clientY);
    const elapsed = event.timeStamp - gesture.startTime;
    if (distance >= SWIPE_THRESHOLD_PX) gesture.moved = true;
    if (gesture.mode !== 'pending') return;

    if (distance >= UNAMBIGUOUS_SWIPE_PX
      || (distance >= SWIPE_THRESHOLD_PX && elapsed < HOLD_TO_FINE_MS)) {
      gesture.mode = 'coarse';
    } else if (elapsed >= HOLD_TO_FINE_MS) {
      // Also recognize time from touch event timestamps if the WebView
      // deferred a pending timeout while the finger was stationary.
      gesture.mode = 'fine';
      setNativeFineMode(part, true);
    }
    if (gesture.mode !== 'pending' && gesture.holdTimer !== null) {
      (event.currentTarget.ownerDocument.defaultView ?? window).clearTimeout(gesture.holdTimer);
      gesture.holdTimer = null;
    }
    // No custom scrollTop writes: CSS pan-y and the WebView own the movement.
  };

  const finishTouch = (part: ThreeColumnPickerPart, view: Window) => {
    const gesture = gestureRef.current[part];
    if (!gesture) return;
    if (gesture.holdTimer !== null) view.clearTimeout(gesture.holdTimer);
    delete gestureRef.current[part];
    // A stationary long press has no native scrollend event. Restore the
    // coarse options on release; otherwise wait for native inertia to settle.
    if (gesture.mode === 'fine' && !gesture.moved) setNativeFineMode(part, false);
  };

  const handleTouchEnd = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    if (!columns[part].gestureStep) return;
    finishTouch(part, event.currentTarget.ownerDocument.defaultView ?? window);
  };

  const handleTouchCancel = (part: ThreeColumnPickerPart) => {
    if (!columns[part].gestureStep) return;
    const view = columnRefs.current[part]?.ownerDocument.defaultView ?? window;
    finishTouch(part, view);
    // WebView touchcancel can mean native pan/kinetic scroll took ownership.
    // Do not replace its snap targets until scrollend.
  };

  const handleSelect = (part: ThreeColumnPickerPart, index: number) => {
    if (!openedRef.current) return;
    signalCrossedValues(part, index, false);
    commitIndex(part, index);
    const top = index * ROW_HEIGHT;
    pendingScrollRef.current = { ...pendingScrollRef.current, [part]: top };
    setScrollTops((current) => ({ ...current, [part]: top }));
    const element = columnRefs.current[part];
    scrollColumn(element, index);
    if (element) scheduleScrollEndFallback(part, element);
  };

  const handleClose = () => {
    PARTS.forEach((part) => {
      if (!columns[part].gestureStep) return;
      const element = columnRefs.current[part];
      if (!element) return;
      const index = Math.max(0, Math.min(displayedColumns[part].values.length - 1,
        Math.round(element.scrollTop / ROW_HEIGHT)));
      signalCrossedValues(part, index, true);
      commitIndex(part, index);
      const view = element.ownerDocument.defaultView ?? window;
      const gesture = gestureRef.current[part];
      if (gesture?.holdTimer !== null && gesture?.holdTimer !== undefined) view.clearTimeout(gesture.holdTimer);
      delete gestureRef.current[part];
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
                column={displayedColumns[part]}
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
            scrollTops={scrollTops}
            lensMode={resolvedLensMode}
            columns={displayedColumns}
            lensXs={lensXs}
            separators={separators}
          />
        </div>
      </div>
    </MezfitPopover>
  );
}
