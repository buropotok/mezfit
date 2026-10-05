import {
  useEffect,
  useId,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { MezfitPopover } from '../konsta-mezfit';
import { Text } from '../primitives';
import { buildTimeLensAssets, type TimeLensAssets } from '../time-picker/timePickerLens';
import {
  resolveTwoColumnPickerLensMode,
  type ResolvedTwoColumnPickerLensMode,
} from '../two-column-picker/lensMode';
import '../time-picker/time-picker.css';
import './weight-reps-picker.css';

const ROW_HEIGHT = 48;
const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
const WHEEL_PADDING = (WHEEL_HEIGHT - ROW_HEIGHT) / 2;
const LENS_TOP = (WHEEL_HEIGHT - LENS_HEIGHT) / 2;
const LENS_SOURCE_VERTICAL_INSET = 8;
const IOS_LENS_MAGNIFICATION = 1.55;

const REPS_VALUES = Array.from({ length: 101 }, (_, index) => index);
const KILOGRAM_VALUES = Array.from({ length: 400 }, (_, index) => index);
const FRACTION_VALUES = [0, 25, 50] as const;

type WeightRepsPickerPart = 'reps' | 'kilograms' | 'fraction';

interface WeightRepsPickerParts {
  reps: number;
  kilograms: number;
  fraction: number;
}

interface PickerColumn {
  ariaLabel: string;
  values: readonly number[];
  format: (value: number) => string;
  formatAria?: (value: number) => string;
  freeMomentum?: boolean;
}

const PARTS: readonly WeightRepsPickerPart[] = ['reps', 'kilograms', 'fraction'];

const COLUMNS: Record<WeightRepsPickerPart, PickerColumn> = {
  reps: {
    ariaLabel: 'Повторения',
    values: REPS_VALUES,
    format: String,
    freeMomentum: true,
  },
  kilograms: {
    ariaLabel: 'Килограммы',
    values: KILOGRAM_VALUES,
    format: String,
    freeMomentum: true,
  },
  fraction: {
    ariaLabel: 'Доли килограмма',
    values: FRACTION_VALUES,
    format: (value) => {
      if (value === 0) return '00';
      if (value === 50) return '5';
      return String(value);
    },
    formatAria: (value) => {
      if (value === 0) return '0,00';
      if (value === 50) return '0,5';
      return `0,${value}`;
    },
  },
};

export interface WeightRepsPickerValue {
  reps: number;
  weightKg: number;
}

export interface WeightRepsPickerProps {
  opened: boolean;
  value: WeightRepsPickerValue;
  onChange: (value: WeightRepsPickerValue) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

type ScrollTops = WeightRepsPickerParts;

function valueIndex(column: PickerColumn, value: number) {
  const index = column.values.indexOf(value);
  if (index < 0) {
    throw new Error(`WeightRepsPicker value ${value} is not present in ${column.ariaLabel}`);
  }
  return index;
}

function partsEqual(left: WeightRepsPickerParts, right: WeightRepsPickerParts) {
  return left.reps === right.reps
    && left.kilograms === right.kilograms
    && left.fraction === right.fraction;
}

function valueToParts(value: WeightRepsPickerValue): WeightRepsPickerParts {
  const weightHundredths = Math.round(value.weightKg * 100);
  return {
    reps: value.reps,
    kilograms: Math.floor(weightHundredths / 100),
    fraction: weightHundredths % 100,
  };
}

function partsToValue(parts: WeightRepsPickerParts): WeightRepsPickerValue {
  return {
    reps: parts.reps,
    weightKg: (parts.kilograms * 100 + parts.fraction) / 100,
  };
}

function partsToScrollTops(parts: WeightRepsPickerParts): ScrollTops {
  return {
    reps: valueIndex(COLUMNS.reps, parts.reps) * ROW_HEIGHT,
    kilograms: valueIndex(COLUMNS.kilograms, parts.kilograms) * ROW_HEIGHT,
    fraction: valueIndex(COLUMNS.fraction, parts.fraction) * ROW_HEIGHT,
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
  column: PickerColumn;
  scrollTop: number;
  lensMode: ResolvedTwoColumnPickerLensMode;
}) {
  return (
    <>
      {visibleLensItems(column.values, scrollTop).map(({ index, value, y }) => {
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
  lensMode,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  lensMode: ResolvedTwoColumnPickerLensMode;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-weight-reps-picker-lens-${reactId}`;
  const clipId = `ui-weight-reps-picker-lens-clip-${reactId}`;
  const sourceClipId = `ui-weight-reps-picker-lens-source-clip-${reactId}`;
  const separatorX = LENS_WIDTH * 0.75;
  const separatorTransform = lensMode === 'ios'
    ? `translate(${separatorX} ${LENS_HEIGHT / 2}) scale(${IOS_LENS_MAGNIFICATION}) translate(${-separatorX} ${-LENS_HEIGHT / 2})`
    : undefined;

  const lensContent = (
    <>
      <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
      <LensText
        x={LENS_WIDTH * 0.25}
        column={COLUMNS.reps}
        scrollTop={scrollTops.reps}
        lensMode={lensMode}
      />
      <LensText
        x={LENS_WIDTH * 0.625}
        column={COLUMNS.kilograms}
        scrollTop={scrollTops.kilograms}
        lensMode={lensMode}
      />
      <text
        x={separatorX}
        y={LENS_HEIGHT / 2}
        transform={separatorTransform}
        textAnchor="middle"
        dominantBaseline="central"
        className="ui-time-picker__lens-separator ui-text--title"
      >
        ,
      </text>
      <LensText
        x={LENS_WIDTH * 0.875}
        column={COLUMNS.fraction}
        scrollTop={scrollTops.fraction}
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
  part,
  selected,
  onScroll,
  onSelect,
  setColumnRef,
}: {
  part: WeightRepsPickerPart;
  selected: number;
  onScroll: (part: WeightRepsPickerPart, event: UIEvent<HTMLDivElement>) => void;
  onSelect: (part: WeightRepsPickerPart, index: number) => void;
  setColumnRef: (part: WeightRepsPickerPart, element: HTMLDivElement | null) => void;
}) {
  const column = COLUMNS[part];

  return (
    <div
      ref={(element) => setColumnRef(part, element)}
      className={`ui-time-picker__column${column.freeMomentum ? ' ui-time-picker__column--free-momentum' : ''}`}
      role="listbox"
      aria-label={column.ariaLabel}
      onScroll={(event) => onScroll(part, event)}
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

function assertWeightRepsPickerValue(value: WeightRepsPickerValue) {
  if (!Number.isInteger(value.reps) || value.reps < 0 || value.reps > 100) {
    throw new Error('WeightRepsPicker reps must be an integer from 0 to 100');
  }

  if (!Number.isFinite(value.weightKg) || value.weightKg < 0 || value.weightKg > 399.5) {
    throw new Error('WeightRepsPicker weightKg must be from 0 to 399.5');
  }

  const scaledWeight = value.weightKg * 100;
  const roundedWeight = Math.round(scaledWeight);
  if (Math.abs(scaledWeight - roundedWeight) > 0.000001) {
    throw new Error('WeightRepsPicker weightKg must use 0, 0.25 or 0.5 fractions');
  }

  const fraction = roundedWeight % 100;
  if (!FRACTION_VALUES.includes(fraction as (typeof FRACTION_VALUES)[number])) {
    throw new Error('WeightRepsPicker weightKg must use 0, 0.25 or 0.5 fractions');
  }
}

export function WeightRepsPicker({
  opened,
  value,
  onChange,
  onClose,
  target,
}: WeightRepsPickerProps) {
  assertWeightRepsPickerValue(value);

  const valueParts = valueToParts(value);
  const resolvedLensMode = resolveTwoColumnPickerLensMode('auto');
  const columnRefs = useRef<Record<WeightRepsPickerPart, HTMLDivElement | null>>({
    reps: null,
    kilograms: null,
    fraction: null,
  });
  const frameRefs = useRef<Record<WeightRepsPickerPart, number | null>>({
    reps: null,
    kilograms: null,
    fraction: null,
  });
  const draftRef = useRef<WeightRepsPickerParts>(valueParts);
  const controlledRef = useRef<WeightRepsPickerParts>(valueParts);
  const onChangeRef = useRef(onChange);
  const openedRef = useRef(opened);
  const wasOpenedRef = useRef(false);
  const reconcileFrameRef = useRef<number | null>(null);
  const feedbackValueRef = useRef<WeightRepsPickerParts>(valueParts);
  const pendingScrollRef = useRef<ScrollTops>(partsToScrollTops(valueParts));

  const [draft, setDraft] = useState<WeightRepsPickerParts>(valueParts);
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);

  controlledRef.current = valueParts;
  onChangeRef.current = onChange;
  openedRef.current = opened;

  const cancelScheduledFrames = (view: Window) => {
    PARTS.forEach((part) => {
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

  const syncColumns = (parts: WeightRepsPickerParts) => {
    PARTS.forEach((part) => {
      scrollColumn(columnRefs.current[part], valueIndex(COLUMNS[part], parts[part]));
    });
  };

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
      cancelScheduledFrames(view);
      return;
    }

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    const valueChanged = !partsEqual(draftRef.current, valueParts);
    if (!justOpened && !valueChanged) return;

    cancelScheduledFrames(view);
    draftRef.current = valueParts;
    feedbackValueRef.current = valueParts;
    setDraft(valueParts);
    const nextScrollTops = partsToScrollTops(valueParts);
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    view.requestAnimationFrame(() => {
      if (!openedRef.current) return;
      syncColumns(valueParts);
    });
  }, [opened, target, valueParts.fraction, valueParts.kilograms, valueParts.reps]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
    cancelScheduledFrames(view);
  }, [target]);

  const commitIndex = (part: WeightRepsPickerPart, index: number) => {
    const column = COLUMNS[part];
    const clampedIndex = Math.max(0, Math.min(column.values.length - 1, index));
    const nextPartValue = column.values[clampedIndex];
    const current = controlledRef.current;
    const next = { ...current, [part]: nextPartValue };

    if (feedbackValueRef.current[part] !== nextPartValue) {
      feedbackValueRef.current = {
        ...feedbackValueRef.current,
        [part]: nextPartValue,
      };
      triggerTelegramSelectionHaptic();
    }

    if (partsEqual(next, current)) {
      draftRef.current = current;
      setDraft(current);
      return;
    }

    draftRef.current = next;
    setDraft(next);
    onChangeRef.current(partsToValue(next));

    const view = target?.ownerDocument.defaultView ?? window;
    if (reconcileFrameRef.current !== null) {
      view.cancelAnimationFrame(reconcileFrameRef.current);
    }
    reconcileFrameRef.current = view.requestAnimationFrame(() => {
      reconcileFrameRef.current = null;
      if (!openedRef.current) return;

      const canonical = controlledRef.current;
      if (partsEqual(canonical, next)) return;

      draftRef.current = canonical;
      feedbackValueRef.current = canonical;
      setDraft(canonical);
      const canonicalScrollTops = partsToScrollTops(canonical);
      pendingScrollRef.current = canonicalScrollTops;
      setScrollTops(canonicalScrollTops);
      syncColumns(canonical);
    });
  };

  const handleScroll = (
    part: WeightRepsPickerPart,
    event: UIEvent<HTMLDivElement>,
  ) => {
    if (!openedRef.current) return;

    const top = event.currentTarget.scrollTop;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: top,
    };

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

  const handleSelect = (part: WeightRepsPickerPart, index: number) => {
    if (!openedRef.current) return;

    commitIndex(part, index);
    const nextTop = index * ROW_HEIGHT;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [part]: nextTop,
    };
    setScrollTops((current) => ({ ...current, [part]: nextTop }));
    scrollColumn(columnRefs.current[part], index);
  };

  const setColumnRef = (
    part: WeightRepsPickerPart,
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
      onBackdropClick={onClose}
      className="ui-time-picker__popover ui-weight-reps-picker__popover"
      style={{ width: '336px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Повторения и вес"
    >
      <div className="ui-time-picker ui-weight-reps-picker">
        <div className="ui-weight-reps-picker__labels">
          <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
            Повторения
          </Text>
          <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
            Вес
          </Text>
        </div>

        <div className="ui-time-picker__wheel">
          <div className="ui-time-picker__columns ui-weight-reps-picker__columns">
            <PickerColumnWheel
              part="reps"
              selected={draft.reps}
              onScroll={handleScroll}
              onSelect={handleSelect}
              setColumnRef={setColumnRef}
            />
            <PickerColumnWheel
              part="kilograms"
              selected={draft.kilograms}
              onScroll={handleScroll}
              onSelect={handleSelect}
              setColumnRef={setColumnRef}
            />
            <PickerColumnWheel
              part="fraction"
              selected={draft.fraction}
              onScroll={handleScroll}
              onSelect={handleSelect}
              setColumnRef={setColumnRef}
            />
          </div>

          <PickerLens
            assets={lensAssets}
            scrollTops={scrollTops}
            lensMode={resolvedLensMode}
          />
        </div>
      </div>
    </MezfitPopover>
  );
}
