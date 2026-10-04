import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from 'react';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { MezfitPopover } from '../konsta-mezfit';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import '../time-picker/time-picker.css';

const ROW_HEIGHT = 48;
const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
const WHEEL_PADDING = (WHEEL_HEIGHT - ROW_HEIGHT) / 2;
const LENS_TOP = (WHEEL_HEIGHT - LENS_HEIGHT) / 2;
const LENS_SOURCE_VERTICAL_INSET = 8;

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
}

type ScrollTops = TwoColumnPickerParts;

function valueIndex(column: TwoColumnPickerColumn, value: number) {
  const index = column.values.indexOf(value);
  if (index < 0) throw new Error(`TwoColumnPicker value ${value} is not present in its column`);
  return index;
}

function partsToScrollTops(
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn],
  parts: TwoColumnPickerParts,
): ScrollTops {
  return {
    left: valueIndex(columns[0], parts.left) * ROW_HEIGHT,
    right: valueIndex(columns[1], parts.right) * ROW_HEIGHT,
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
  values: readonly number[],
  scrollTop: number,
) {
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

function LensText({
  x,
  column,
  scrollTop,
}: {
  x: number;
  column: TwoColumnPickerColumn;
  scrollTop: number;
}) {
  return (
    <>
      {visibleLensItems(column.values, scrollTop).map(({ index, value, y }) => (
        <text
          key={index}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          className="ui-time-picker__lens-text ui-text--title"
        >
          {column.format(value)}
        </text>
      ))}
    </>
  );
}

function PickerLens({
  assets,
  scrollTops,
  columns,
  separator,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn];
  separator?: string;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-time-picker-lens-${reactId}`;
  const clipId = `ui-time-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-time-picker-lens-source-clip-${reactId}`;

  return (
    <div className="ui-time-picker__lens" aria-hidden="true">
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
          {assets ? (
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

        <g clipPath={`url(#${clipId})`}>
          <g filter={assets ? `url(#${filterId})` : undefined}>
            <g clipPath={`url(#${sourceClipId})`}>
              <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
              <LensText x={LENS_WIDTH * 0.25} column={columns[0]} scrollTop={scrollTops.left} />
              {separator ? (
                <text
                  x={LENS_WIDTH * 0.5}
                  y={LENS_HEIGHT / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="ui-time-picker__lens-separator ui-text--title"
                >
                  {separator}
                </text>
              ) : null}
              <LensText x={LENS_WIDTH * 0.75} column={columns[1]} scrollTop={scrollTops.right} />
            </g>
          </g>
        </g>
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
  columnRef,
}: {
  side: TwoColumnPickerSide;
  column: TwoColumnPickerColumn;
  selected: number;
  onScroll: (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => void;
  onSelect: (side: TwoColumnPickerSide, index: number) => void;
  columnRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={columnRef}
      className={`ui-time-picker__column${column.freeMomentum ? ' ui-time-picker__column--free-momentum' : ''}`}
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(side, event)}
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
}: TwoColumnPickerProps) {
  valueIndex(columns[0], value.left);
  valueIndex(columns[1], value.right);

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
  const feedbackValueRef = useRef<TwoColumnPickerParts>(value);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(columns, value));

  const [draft, setDraft] = useState<TwoColumnPickerParts>(value);
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = value;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  useEffect(() => {
    if (!opened || lensAssets) return undefined;

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
  }, [lensAssets, opened, target]);

  useEffect(() => {
    const view = target?.ownerDocument.defaultView ?? window;

    if (!opened) {
      wasOpenedRef.current = false;

      if (leftFrameRef.current !== null) {
        view.cancelAnimationFrame(leftFrameRef.current);
        leftFrameRef.current = null;
      }
      if (rightFrameRef.current !== null) {
        view.cancelAnimationFrame(rightFrameRef.current);
        rightFrameRef.current = null;
      }
      if (reconcileFrameRef.current !== null) {
        view.cancelAnimationFrame(reconcileFrameRef.current);
        reconcileFrameRef.current = null;
      }
      return;
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
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
      reconcileFrameRef.current = null;
    }

    draftRef.current = value;
    feedbackValueRef.current = value;
    setDraft(value);
    const nextScrollTops = partsToScrollTops(columns, value);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    view.requestAnimationFrame(() => {
      if (!openedRef.current) return;
      scrollColumn(leftRef.current, valueIndex(columns[0], value.left));
      scrollColumn(rightRef.current, valueIndex(columns[1], value.right));
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
    const clampedIndex = Math.max(0, Math.min(column.values.length - 1, index));
    const nextValue = column.values[clampedIndex];
    const current = controlledRef.current;
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

    const view = target?.ownerDocument.defaultView ?? window;
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
    }
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current) return;

      const canonical = controlledRef.current;
      if (canonical.left === next.left && canonical.right === next.right) return;

      draftRef.current = canonical;
      feedbackValueRef.current = canonical;
      setDraft(canonical);
      const canonicalScrollTops = partsToScrollTops(columns, canonical);
      pendingScrollRef.current = canonicalScrollTops;
      setScrollTops(canonicalScrollTops);
      scrollColumn(leftRef.current, valueIndex(columns[0], canonical.left));
      scrollColumn(rightRef.current, valueIndex(columns[1], canonical.right));
    });
  };

  const handleScroll = (side: TwoColumnPickerSide, event: UIEvent<HTMLDivElement>) => {
    if (!openedRef.current) return;

    const top = event.currentTarget.scrollTop;
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

    commitIndex(side, index);
    const nextTop = index * ROW_HEIGHT;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [side]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [side]: nextTop }));
    scrollColumn(side === 'left' ? leftRef.current : rightRef.current, index);
  };

  return (
    <MezfitPopover
      opened={opened}
      target={target ?? undefined}
      angle={false}
      backdrop
      iosHighlight={false}
      onBackdropClick={onClose}
      className="ui-time-picker__popover"
      style={{ width: '336px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="ui-time-picker">
        <div className="ui-time-picker__wheel">
          <div className="ui-time-picker__columns">
            <PickerColumnWheel
              side="left"
              column={columns[0]}
              selected={draft.left}
              onScroll={handleScroll}
              onSelect={handleSelect}
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
              columnRef={rightRef}
            />
          </div>

          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            columns={columns}
            separator={separator}
          />
        </div>
      </div>
    </MezfitPopover>
  );
}
