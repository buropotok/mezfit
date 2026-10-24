import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
  type TouchEvent,
} from 'react';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { MezfitPopover } from '../konsta-mezfit';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import {
  resolveTwoColumnPickerLensMode,
  type ResolvedTwoColumnPickerLensMode,
  type TwoColumnPickerLensMode,
} from './lensMode';
import '../time-picker/time-picker.css';

const ROW_HEIGHT = 48;
const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
const WHEEL_PADDING = (WHEEL_HEIGHT - ROW_HEIGHT) / 2;
const LENS_TOP = (WHEEL_HEIGHT - LENS_HEIGHT) / 2;
const LENS_SOURCE_VERTICAL_INSET = 8;
const IOS_LENS_MAGNIFICATION = 1.55;

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
  freeMomentum?: boolean;
  circular?: boolean;
  flickSnapStep?: number;
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

function wheelIndex(column: TwoColumnPickerColumn, index: number) {
  return index + (column.circular ? column.values.length : 0);
}

function renderedLength(column: TwoColumnPickerColumn) {
  return column.values.length * (column.circular ? 3 : 1);
}

function wheelValue(column: TwoColumnPickerColumn, index: number) {
  const resolved = column.circular ? wrapIndex(index, column.values.length)
    : Math.max(0, Math.min(index, column.values.length - 1));
  return column.values[resolved];
}

function partsToScrollTops(
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn],
  parts: TwoColumnPickerParts,
): ScrollTops {
  return {
    left: wheelIndex(columns[0], valueIndex(columns[0], parts.left)) * ROW_HEIGHT,
    right: wheelIndex(columns[1], valueIndex(columns[1], parts.right)) * ROW_HEIGHT,
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

function visibleLensItems(
  column: TwoColumnPickerColumn,
  scrollTop: number,
) {
  const centerIndex = Math.round(scrollTop / ROW_HEIGHT);
  const start = Math.max(0, centerIndex - 1);
  const end = Math.min(renderedLength(column) - 1, centerIndex + 1);

  return Array.from({ length: end - start + 1 }, (_, localIndex) => {
    const index = start + localIndex;
    const value = wheelValue(column, index);
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
  column: TwoColumnPickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
}) {
  return (
    <>
      {visibleLensItems(column, scrollTop).map(({ index, value, y }) => {
        const scale = lensMode === 'ios' ? iosLensScale(y) : 1;
        const transform = lensMode === 'ios' && scale !== 1
          ? `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`
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
  columns,
  separator,
  lensMode,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn];
  separator?: string;
  lensMode: ResolvedTwoColumnPickerLensMode;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-time-picker-lens-${reactId}`;
  const clipId = `ui-time-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-time-picker-lens-source-clip-${reactId}`;
  const separatorTransform = lensMode === 'ios'
    ? `translate(${LENS_WIDTH * 0.5} ${LENS_HEIGHT / 2}) scale(${IOS_LENS_MAGNIFICATION}) translate(${-LENS_WIDTH * 0.5} ${-LENS_HEIGHT / 2})`
    : undefined;

  const lensContent = (
    <>
      <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
      <LensText
        x={LENS_WIDTH * 0.25}
        column={columns[0]}
        scrollTop={scrollTops.left}
        lensMode={lensMode}
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
        x={LENS_WIDTH * 0.75}
        column={columns[1]}
        scrollTop={scrollTops.right}
        lensMode={lensMode}
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

function PickerColumnWheel({
  side,
  column,
  selected,
  onScroll,
  onSelect,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  quarterSnap,
  columnRef,
}: {
  side: TwoColumnPickerSide;
  column: TwoColumnPickerColumn;
  selected: number;
  onScroll: (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => void;
  onSelect: (side: TwoColumnPickerSide, index: number) => void;
  onTouchStart: (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => void;
  onTouchCancel: (side: TwoColumnPickerSide) => void;
  quarterSnap: boolean;
  columnRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={columnRef}
      className={`ui-time-picker__column${column.freeMomentum ? ' ui-time-picker__column--free-momentum' : ''}${quarterSnap ? ' ui-time-picker__column--quarter-snap' : ''}`}
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(side, event)}
      onTouchStart={(event) => onTouchStart(side, event)}
      onTouchMove={(event) => onTouchMove(side, event)}
      onTouchEnd={(event) => onTouchEnd(side, event)}
      onTouchCancel={() => onTouchCancel(side)}
    >
      {Array.from({ length: renderedLength(column) }, (_, index) => {
        const value = wheelValue(column, index);
        const duplicate = Boolean(column.circular && (index < column.values.length || index >= column.values.length * 2));
        const isSelected = value === selected;
        const quarterStop = Boolean(column.flickSnapStep && index % column.values.length % column.flickSnapStep === 0);
        const label = column.format(value);

        return (
          <button
            key={index}
            type="button"
            className={`ui-time-picker__option ui-text--body${isSelected ? ' ui-time-picker__option--selected' : ''}${quarterStop ? ' ui-time-picker__option--quarter-stop' : ''}`}
            role={duplicate ? undefined : 'option'}
            aria-hidden={duplicate || undefined}
            tabIndex={duplicate ? -1 : 0}
            aria-label={duplicate ? undefined : column.formatAria?.(value) ?? label}
            aria-selected={duplicate ? undefined : isSelected}
            onClick={() => onSelect(side, index)}
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
}: TwoColumnPickerProps) {
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
  const touchStartRef = useRef<Partial<Record<TwoColumnPickerSide, { y: number; time: number }>>>({});
  const quarterSnapRef = useRef<Record<TwoColumnPickerSide, boolean>>({ left: false, right: false });
  const [quarterSnap, setQuarterSnap] = useState<Record<TwoColumnPickerSide, boolean>>({ left: false, right: false });
  const feedbackValueRef = useRef<TwoColumnPickerParts>(value);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, value));

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
      if (!cancelled) setLensAssets(buildTimeLensAssets(documentRef));
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
      quarterSnapRef.current = { left: false, right: false };
      setQuarterSnap(quarterSnapRef.current);
      touchStartRef.current = {};

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
    if (!justOpened && !valueChanged) return;

    if (leftFrameRef.current !== null) {
      view.cancelAnimationFrame(leftFrameRef.current);
      leftFrameRef.current = null;
    }
    if (rightFrameRef.current !== null) {
      view.cancelAnimationFrame(rightFrameRef.current);
      rightFrameRef.current = null;
    }

    draftRef.current = value;
    feedbackValueRef.current = value;
    setDraft(value);
    const nextScrollTops = partsToScrollTops(columns, value);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    view.requestAnimationFrame(() => {
      if (!openedRef.current) return;
      scrollColumn(leftRef.current, wheelIndex(columns[0], valueIndex(columns[0], value.left)));
      scrollColumn(rightRef.current, wheelIndex(columns[1], valueIndex(columns[1], value.right)));
    });
  }, [columns, opened, target, value.left, value.right]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
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

    if (feedbackValueRef.current[side] !== nextValue) {
      feedbackValueRef.current = {
        ...feedbackValueRef.current,
        [side]: nextValue,
      };
      triggerTelegramSelectionHaptic();
    }

    if (next.left === current.left && next.right === current.right) {
      draftRef.current = current;
      setDraft(current);
      return;
    }

    draftRef.current = next;
    setDraft(next);
    onChangeRef.current(next);

    // Legacy finite pickers remain strictly controlled. Circular time wheels use
    // an editable in-flight value so momentum never fights a pending parent update.
    if (!columns[0].circular && !columns[1].circular) {
      const view = target?.ownerDocument.defaultView ?? window;
      if (reconcileFrameRef.current !== null) view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = view.requestAnimationFrame(() => {
        reconcileFrameRef.current = null;
        if (!openedRef.current) return;
        const canonical = controlledRef.current;
        if (canonical.left === next.left && canonical.right === next.right) return;
        draftRef.current = canonical;
        feedbackValueRef.current = canonical;
        setDraft(canonical);
        const tops = partsToScrollTops(columns, canonical);
        pendingScrollRef.current = tops;
        setScrollTops(tops);
        scrollColumn(leftRef.current, valueIndex(columns[0], canonical.left));
        scrollColumn(rightRef.current, valueIndex(columns[1], canonical.right));
      });
    }
  };

  const setQuarterSnapMode = (side: TwoColumnPickerSide, enabled: boolean) => {
    if (quarterSnapRef.current[side] === enabled) return;
    quarterSnapRef.current = { ...quarterSnapRef.current, [side]: enabled };
    setQuarterSnap(quarterSnapRef.current);
  };

  const handleTouchStart = (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current[side] = { y: touch.clientY, time: event.timeStamp };
    setQuarterSnapMode(side, false);
  };

  const isFastSwipe = (side: TwoColumnPickerSide, y: number, time: number) => {
    const start = touchStartRef.current[side];
    if (!start) return false;
    const distance = Math.abs(y - start.y);
    const duration = Math.max(1, time - start.time);
    return distance >= 36 && duration <= 500 && distance / duration >= 0.35;
  };

  const handleTouchMove = (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => {
    const column = side === 'left' ? columns[0] : columns[1];
    const touch = event.touches[0];
    if (!column.flickSnapStep || !touch) return;
    // Enable coarse native scroll snapping while the finger is moving:
    // the browser chooses one final quarter-hour stop as part of its inertia.
    if (isFastSwipe(side, touch.clientY, event.timeStamp)) setQuarterSnapMode(side, true);
  };

  const handleTouchEnd = (side: TwoColumnPickerSide, event: TouchEvent<HTMLDivElement>) => {
    const column = side === 'left' ? columns[0] : columns[1];
    const touch = event.changedTouches[0];
    setQuarterSnapMode(side, Boolean(column.flickSnapStep && touch
      && isFastSwipe(side, touch.clientY, event.timeStamp)));
    delete touchStartRef.current[side];
  };

  const handleTouchCancel = (side: TwoColumnPickerSide) => {
    delete touchStartRef.current[side];
    setQuarterSnapMode(side, false);
  };

  const handleScroll = (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => {
    if (!openedRef.current) return;

    const column = side === 'left' ? columns[0] : columns[1];
    let top = event.currentTarget.scrollTop;
    if (column.circular) {
      const cycleHeight = column.values.length * ROW_HEIGHT;
      // Shift identical neighboring cycles back to the middle long before an edge is visible.
      if (top < cycleHeight * 0.25) top += cycleHeight;
      else if (top > cycleHeight * 2.75) top -= cycleHeight;
      if (top !== event.currentTarget.scrollTop) event.currentTarget.scrollTop = top;
    }
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [side]: top,
    };

    const frameRef = side === 'left' ? leftFrameRef : rightFrameRef;
    if (frameRef.current !== null) return;

    const view = event.currentTarget.ownerDocument.defaultView ?? window;

    frameRef.current = view.requestAnimationFrame(() => {
      frameRef.current = null;
      if (!openedRef.current) return;

      const nextTop = pendingScrollRef.current[side];
      setScrollTops((current) => ({ ...current, [side]: nextTop }));
      commitIndex(side, Math.round(nextTop / ROW_HEIGHT));
    });
  };

  const handleSelect = (side: TwoColumnPickerSide, index: number) => {
    if (!openedRef.current) return;

    handleTouchCancel(side);
    commitIndex(side, index);
    const column = side === 'left' ? columns[0] : columns[1];
    const nextIndex = column.circular ? wheelIndex(column, index % column.values.length) : index;
    const nextTop = nextIndex * ROW_HEIGHT;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [side]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [side]: nextTop }));
    scrollColumn(side === 'left' ? leftRef.current : rightRef.current, nextIndex);
  };

  const handleClose = () => {
    // If dismissed mid-inertia, commit the visible position (or the quarter
    // native snapping was already targeting) without moving the closing wheel.
    (['left', 'right'] as const).forEach(side => {
      const column = side === 'left' ? columns[0] : columns[1];
      if (!column.flickSnapStep) return;
      const element = side === 'left' ? leftRef.current : rightRef.current;
      if (!element) return;
      const index = Math.round(element.scrollTop / ROW_HEIGHT);
      const finalIndex = quarterSnapRef.current[side]
        ? Math.round(index / column.flickSnapStep) * column.flickSnapStep
        : index;
      commitIndex(side, finalIndex);
    });
    onClose();
  };

  return (
    <MezfitPopover
      opened={opened}
      target={target ?? undefined}
      angle={false}
      backdrop
      iosHighlight={false}
      onBackdropClick={handleClose}
      className="ui-time-picker__popover"
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
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
              quarterSnap={quarterSnap.left}
              columnRef={leftRef}
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
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
              quarterSnap={quarterSnap.right}
              columnRef={rightRef}
            />
          </div>

          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            columns={columns}
            separator={separator}
            lensMode={resolvedLensMode}
          />
        </div>
      </div> : null}
    </MezfitPopover>
  );
}
