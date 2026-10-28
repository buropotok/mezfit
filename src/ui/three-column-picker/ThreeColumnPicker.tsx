import {
  useEffect,
  useId,
  useRef,
  useState,
  type UIEvent,
  type TouchEvent,
  type WheelEvent,
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
// A deliberate hold unlocks one-unit control; swipes advance by configured strides.
// A small finger drift during the hold must not permanently select coarse
// mode. The threshold still recognizes a deliberate swipe before the hold.
const HOLD_TO_FINE_MS = 240;
const SWIPE_THRESHOLD_PX = 20;
// A first reported movement this large is swipe intent even if WebView
// delayed its event beyond the hold window. Preserve slow swipe-by-tens.
const UNAMBIGUOUS_SWIPE_PX = 64;
const FLING_MAX_DECADES = 18;

type StepGesture = {
  startY: number;
  startTime: number;
  startIndex: number;
  lastY: number;
  lastTime: number;
  recentSpeed: number;
  mode: 'pending' | 'fine' | 'coarse';
  holdTimer: number | null;
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
  /** Opt-in decade swipes with velocity-scaled inertia and hold-to-scrub precision. */
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
  onWheel,
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
  onWheel: (part: ThreeColumnPickerPart, event: WheelEvent<HTMLDivElement>) => void;
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
      onWheel={(event) => onWheel(part, event)}
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
  const gestureRef = useRef<Partial<Record<ThreeColumnPickerPart, StepGesture>>>({});
  const flingFrameRef = useRef<Record<ThreeColumnPickerPart, number | null>>({
    first: null, second: null, third: null,
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
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, valueParts));

  const [draft, setDraft] = useState<ThreeColumnPickerParts>(valueParts);
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = valueParts;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  const cancelScheduledFrames = (view: Window) => {
    PARTS.forEach((part) => {
      const gesture = gestureRef.current[part];
      if (gesture?.holdTimer != null) view.clearTimeout(gesture.holdTimer);
      const momentum = flingFrameRef.current[part];
      if (momentum !== null) {
        view.cancelAnimationFrame(momentum);
        flingFrameRef.current[part] = null;
      }
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
      scrollColumn(columnRefs.current[part], valueIndex(columns[part], parts[part]));
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
      gestureRef.current = {};
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
    const values = columns[part].values;
    const nextIndex = Math.max(0, Math.min(values.length - 1, index));
    const lastIndex = valueIndex(columns[part], feedbackValueRef.current[part]);
    if (lastIndex === nextIndex) return;

    // Scroll events may skip multiple rows: issue one tick per crossed value,
    // even if React commits only the most recent position this animation frame.
    if (fromScroll) {
      const step = nextIndex > lastIndex ? 1 : -1;
      for (let cursor = lastIndex + step; cursor !== nextIndex + step; cursor += step) {
        triggerTelegramSelectionHaptic();
      }
    } else {
      triggerTelegramSelectionHaptic();
    }
    feedbackValueRef.current = { ...feedbackValueRef.current, [part]: values[nextIndex] };
  };

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
    if (!openedRef.current || columns[part].gestureStep) return;
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
    signalCrossedValues(part, index, true);
    commitIndex(part, index);
    if (scrollingPartsRef.current.size > 0) return;

    // Only reconcile a rejected controlled value after all wheels stop.
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current || scrollingPartsRef.current.size > 0
        || PARTS.some((candidate) => gestureRef.current[candidate]
          || flingFrameRef.current[candidate] !== null)) return;
      const canonical = controlledRef.current;
      if (!partsEqual(draftRef.current, canonical)) {
        draftRef.current = canonical;
        feedbackValueRef.current = canonical;
        setDraft(canonical);
        const tops = partsToScrollTops(columns, canonical);
        pendingScrollRef.current = tops;
        setScrollTops(tops);
        syncColumns(canonical);
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
    if (!openedRef.current || columns[part].gestureStep) return;

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

  // Gesture-owned columns ignore native scroll events entirely. Only their
  // touch handlers may update the selected number and physical scrollTop.
  const setGestureIndex = (part: ThreeColumnPickerPart, requested: number, stride: number) => {
    const column = columns[part];
    // Preserve the original unit digit: 77 -> 87 -> 97, not 77 -> 90.
    const remainder = valueIndex(column, feedbackValueRef.current[part]) % stride;
    const last = remainder + Math.floor((column.values.length - 1 - remainder) / stride) * stride;
    const index = Math.max(remainder, Math.min(last, requested));
    const previous = valueIndex(column, feedbackValueRef.current[part]);
    if (previous === index) return;
    const crossed = stride === 1 ? Math.abs(index - previous)
      : Math.max(1, Math.ceil(Math.abs(index - previous) / stride));
    for (let n = 0; n < crossed; n += 1) triggerTelegramSelectionHaptic();
    feedbackValueRef.current = { ...feedbackValueRef.current, [part]: column.values[index] };
    commitIndex(part, index);
    const top = index * ROW_HEIGHT;
    pendingScrollRef.current = { ...pendingScrollRef.current, [part]: top };
    setScrollTops((current) => ({ ...current, [part]: top }));
    scrollColumn(columnRefs.current[part], index);
  };

  const cancelFling = (part: ThreeColumnPickerPart, view: Window) => {
    const id = flingFrameRef.current[part];
    if (id !== null) view.cancelAnimationFrame(id);
    flingFrameRef.current[part] = null;
  };

  const finishGesture = (part: ThreeColumnPickerPart) => {
    const view = columnRefs.current[part]?.ownerDocument.defaultView ?? window;
    if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current || scrollingPartsRef.current.size > 0
        || PARTS.some((candidate) => gestureRef.current[candidate]
          || flingFrameRef.current[candidate] !== null)) return;
      const canonical = controlledRef.current;
      if (!partsEqual(draftRef.current, canonical)) {
        draftRef.current = canonical;
        feedbackValueRef.current = canonical;
        setDraft(canonical);
        const tops = partsToScrollTops(columns, canonical);
        pendingScrollRef.current = tops;
        setScrollTops(tops);
        syncColumns(canonical);
      }
      locallyEmittedRef.current.clear();
    });
  };

  const updateGesturePosition = (part: ThreeColumnPickerPart, gesture: StepGesture, y: number) => {
    const distance = gesture.startY - y;
    const step = columns[part].gestureStep ?? 1;
    const index = gesture.mode === 'fine'
      ? gesture.startIndex + Math.round(distance / ROW_HEIGHT)
      : gesture.startIndex
        + Math.sign(distance) * Math.max(1, Math.round(Math.abs(distance) / 40)) * step;
    setGestureIndex(part, index, gesture.mode === 'fine' ? 1 : step);
  };

  const handleTouchStart = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!columns[part].gestureStep || !touch || !openedRef.current) return;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    cancelFling(part, view);
    const old = gestureRef.current[part];
    if (old?.holdTimer != null) view.clearTimeout(old.holdTimer);
    const gesture: StepGesture = {
      startY: touch.clientY, startTime: event.timeStamp,
      startIndex: valueIndex(columns[part], draftRef.current[part]),
      lastY: touch.clientY, lastTime: event.timeStamp,
      recentSpeed: 0, mode: 'pending', holdTimer: null,
    };
    gesture.holdTimer = view.setTimeout(() => {
      if (gestureRef.current[part] === gesture && gesture.mode === 'pending') gesture.mode = 'fine';
      gesture.holdTimer = null;
    }, HOLD_TO_FINE_MS);
    gestureRef.current[part] = gesture;
  };

  const handleTouchMove = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current[part];
    const touch = event.touches[0];
    if (!columns[part].gestureStep || !gesture || !touch) return;
    const y = touch.clientY;
    const dt = event.timeStamp - gesture.lastTime;
    const dy = gesture.lastY - y;
    if (dt > 0 && dt <= 160 && Math.abs(dy) >= 1) gesture.recentSpeed = Math.abs(dy / dt);
    gesture.lastY = y;
    gesture.lastTime = event.timeStamp;
    if (gesture.mode === 'pending') {
      // Long-press detection must not rely solely on a timer. WKWebView may
      // delay the timer while a finger is down; touch timestamps still preserve
      // the elapsed time when a move is finally delivered.
      const distance = Math.abs(gesture.startY - y);
      if (distance >= UNAMBIGUOUS_SWIPE_PX
        || (distance >= SWIPE_THRESHOLD_PX && event.timeStamp - gesture.startTime < HOLD_TO_FINE_MS)) {
        gesture.mode = 'coarse';
      } else if (event.timeStamp - gesture.startTime >= HOLD_TO_FINE_MS) {
        gesture.mode = 'fine';
      }
      if (gesture.mode !== 'pending' && gesture.holdTimer !== null) {
        (event.currentTarget.ownerDocument.defaultView ?? window).clearTimeout(gesture.holdTimer);
        gesture.holdTimer = null;
      }
    }
    if (gesture.mode !== 'pending') updateGesturePosition(part, gesture, y);
  };

  const completeGesture = (part: ThreeColumnPickerPart, y: number, time: number, view: Window) => {
    const gesture = gestureRef.current[part];
    if (!gesture) return;
    if (gesture.holdTimer !== null) view.clearTimeout(gesture.holdTimer);
    const distance = gesture.startY - y;
    if (gesture.mode === 'pending') {
      // A delayed timer must also be recognized when the next event is touchend.
      // With no displacement this remains a tap, not a fine-drag mutation.
      if (Math.abs(distance) >= UNAMBIGUOUS_SWIPE_PX
        || (Math.abs(distance) >= SWIPE_THRESHOLD_PX && time - gesture.startTime < HOLD_TO_FINE_MS)) {
        gesture.mode = 'coarse';
      } else if (time - gesture.startTime >= HOLD_TO_FINE_MS) {
        gesture.mode = 'fine';
      }
    }
    if (gesture.mode === 'pending') {
      delete gestureRef.current[part];
      return;
    }
    updateGesturePosition(part, gesture, y);
    delete gestureRef.current[part];
    if (gesture.mode === 'fine' || Math.abs(distance) < SWIPE_THRESHOLD_PX) {
      finishGesture(part);
      return;
    }

    const speed = Math.max(Math.abs(distance) / Math.max(1, time - gesture.startTime),
      time - gesture.lastTime <= 120 ? gesture.recentSpeed : 0);
    const requestedSteps = Math.max(1, Math.min(FLING_MAX_DECADES, Math.round(speed * 6)));
    const stride = columns[part].gestureStep ?? 1;
    const start = valueIndex(columns[part], draftRef.current[part]);
    const remainder = start % stride;
    const last = remainder + Math.floor((columns[part].values.length - 1 - remainder) / stride) * stride;
    const direction = Math.sign(distance);
    const target = Math.max(remainder, Math.min(last, start + direction * requestedSteps * stride));
    const steps = Math.abs(target - start) / stride;
    if (steps === 0) {
      finishGesture(part);
      return;
    }
    const duration = Math.min(950, 210 + steps * 42);
    let began: number | null = null;
    const animate = (timestamp: number) => {
      if (!openedRef.current) {
        flingFrameRef.current[part] = null;
        return;
      }
      if (began === null) began = timestamp;
      const progress = Math.min(1, (timestamp - began) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const passed = Math.min(steps, Math.floor(steps * eased));
      setGestureIndex(part, start + direction * passed * stride, stride);
      if (progress < 1 && passed < steps) {
        flingFrameRef.current[part] = view.requestAnimationFrame(animate);
      } else {
        setGestureIndex(part, target, stride);
        flingFrameRef.current[part] = null;
        finishGesture(part);
      }
    };
    flingFrameRef.current[part] = view.requestAnimationFrame(animate);
  };

  const handleTouchEnd = (part: ThreeColumnPickerPart, event: TouchEvent<HTMLDivElement>) => {
    if (!columns[part].gestureStep) return;
    const touch = event.changedTouches[0];
    const gesture = gestureRef.current[part];
    if (!touch || !gesture) return;
    if (gesture.mode !== 'pending' || Math.abs(touch.clientY - gesture.startY) >= SWIPE_THRESHOLD_PX) {
      // Do not synthesize a button click after a drag or a decade fling.
      event.preventDefault();
    }
    completeGesture(part, touch.clientY, event.timeStamp,
      event.currentTarget.ownerDocument.defaultView ?? window);
  };

  const handleTouchCancel = (part: ThreeColumnPickerPart) => {
    const gesture = gestureRef.current[part];
    if (!gesture) return;
    const view = columnRefs.current[part]?.ownerDocument.defaultView ?? window;
    if (gesture.holdTimer !== null) view.clearTimeout(gesture.holdTimer);
    delete gestureRef.current[part];
    finishGesture(part);
  };

  const handleWheel = (part: ThreeColumnPickerPart, event: WheelEvent<HTMLDivElement>) => {
    if (!openedRef.current || !columns[part].gestureStep || event.deltaY === 0) return;
    // A mouse wheel/trackpad isn't a finger swipe: keep desktop fine control.
    event.preventDefault();
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    cancelFling(part, view);
    const gesture = gestureRef.current[part];
    if (gesture?.holdTimer != null) view.clearTimeout(gesture.holdTimer);
    delete gestureRef.current[part];
    const current = valueIndex(columns[part], draftRef.current[part]);
    setGestureIndex(part, current + Math.sign(event.deltaY), 1);
    finishGesture(part);
  };

  const handleSelect = (part: ThreeColumnPickerPart, index: number) => {
    if (!openedRef.current) return;

    if (columns[part].gestureStep) {
      const view = columnRefs.current[part]?.ownerDocument.defaultView ?? window;
      cancelFling(part, view);
      const gesture = gestureRef.current[part];
      if (gesture?.holdTimer != null) view.clearTimeout(gesture.holdTimer);
      delete gestureRef.current[part];
    }
    signalCrossedValues(part, index, false);
    commitIndex(part, index);
    const nextTop = index * ROW_HEIGHT;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [part]: nextTop }));
    const element = columnRefs.current[part];
    scrollColumn(element, index);
    if (element && !columns[part].gestureStep) scheduleScrollEndFallback(part, element);
  };

  const handleClose = () => {
    PARTS.forEach((part) => {
      if (!columns[part].gestureStep) return;
      const view = columnRefs.current[part]?.ownerDocument.defaultView ?? window;
      cancelFling(part, view);
      const gesture = gestureRef.current[part];
      if (gesture?.holdTimer != null) view.clearTimeout(gesture.holdTimer);
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
                column={columns[part]}
                selected={draft[part]}
                onScroll={handleScroll}
                onScrollEnd={handleScrollEnd}
                onSelect={handleSelect}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                onWheel={handleWheel}
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
          />
        </div>
      </div>
    </MezfitPopover>
  );
}
