import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from 'react';
import { MezfitPopover } from '../konsta-mezfit';
import { buildTimeLensAssets, type TimeLensAssets } from './timePickerLens';
import {
  formatLocalTime,
  parseLocalTime,
  type LocalTime,
  type LocalTimeParts,
} from './timePickerTime';
import './time-picker.css';

const HOUR_VALUES = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => index);
const ROW_HEIGHT = 48;
const WHEEL_HEIGHT = 240;
const LENS_HEIGHT = 72;
const LENS_WIDTH = 288;
const WHEEL_PADDING = (WHEEL_HEIGHT - ROW_HEIGHT) / 2;
const LENS_TOP = (WHEEL_HEIGHT - LENS_HEIGHT) / 2;

export interface TimePickerProps {
  opened: boolean;
  value: LocalTime;
  onChange: (value: LocalTime) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

type TimeColumn = 'hour' | 'minute';

type ScrollTops = {
  hour: number;
  minute: number;
};

function formatUnit(value: number) {
  return String(value).padStart(2, '0');
}

function scrollColumn(element: HTMLDivElement | null, index: number, smooth = false) {
  if (!element) return;

  const top = index * ROW_HEIGHT;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    element.scrollTop = top;
  }
}

function visibleLensItems(values: readonly number[], scrollTop: number) {
  const centerIndex = Math.round(scrollTop / ROW_HEIGHT);
  const start = Math.max(0, centerIndex - 2);
  const end = Math.min(values.length - 1, centerIndex + 2);

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
  values,
  scrollTop,
}: {
  x: number;
  values: readonly number[];
  scrollTop: number;
}) {
  return (
    <>
      {visibleLensItems(values, scrollTop).map(({ index, value, y }) => (
        <text
          key={index}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          className="ui-time-picker__lens-text"
        >
          {formatUnit(value)}
        </text>
      ))}
    </>
  );
}

function TimeLens({
  assets,
  scrollTops,
  active,
}: {
  assets: TimeLensAssets | null;
  scrollTops: ScrollTops;
  active: boolean;
}) {
  const reactId = useId().replace(/:/g, '');
  const filterId = `ui-time-picker-lens-${reactId}`;
  const clipId = `ui-time-picker-lens-clip-${reactId}`;

  return (
    <div
      className={`ui-time-picker__lens${active ? ' ui-time-picker__lens--active' : ''}`}
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
              <feImage
                href={assets.specularHref}
                x="0"
                y="0"
                width={LENS_WIDTH}
                height={LENS_HEIGHT}
                preserveAspectRatio="none"
                result="specular"
              />
              <feGaussianBlur in="specular" stdDeviation="0.35" result="specularBloom" />
              <feComponentTransfer in="specularBloom" result="specularAlpha">
                <feFuncA type="linear" slope="0.5" />
              </feComponentTransfer>
              <feColorMatrix
                in="specularAlpha"
                type="saturate"
                values="9"
                result="specularSaturated"
              />
              <feBlend in="refracted" in2="specularSaturated" mode="screen" />
            </filter>
          ) : null}
        </defs>

        <rect
          width={LENS_WIDTH}
          height={LENS_HEIGHT}
          rx={LENS_HEIGHT / 2}
          className="ui-time-picker__lens-base"
        />

        <g
          clipPath={`url(#${clipId})`}
          filter={assets ? `url(#${filterId})` : undefined}
        >
          <rect width={LENS_WIDTH} height={LENS_HEIGHT} fill="transparent" />
          <LensText x={LENS_WIDTH * 0.25} values={HOUR_VALUES} scrollTop={scrollTops.hour} />
          <text
            x={LENS_WIDTH * 0.5}
            y={LENS_HEIGHT / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="ui-time-picker__lens-separator"
          >
            :
          </text>
          <LensText x={LENS_WIDTH * 0.75} values={MINUTE_VALUES} scrollTop={scrollTops.minute} />
        </g>

        <rect
          x="0.5"
          y="0.5"
          width={LENS_WIDTH - 1}
          height={LENS_HEIGHT - 1}
          rx={(LENS_HEIGHT - 1) / 2}
          className="ui-time-picker__lens-border"
        />
      </svg>
    </div>
  );
}

function TimeColumnWheel({
  kind,
  values,
  selected,
  onScroll,
  onSelect,
  onInteractionChange,
  columnRef,
}: {
  kind: TimeColumn;
  values: readonly number[];
  selected: number;
  onScroll: (kind: TimeColumn, event: UIEvent<HTMLDivElement>) => void;
  onSelect: (kind: TimeColumn, index: number) => void;
  onInteractionChange: (active: boolean) => void;
  columnRef: RefObject<HTMLDivElement | null>;
}) {
  const label = kind === 'hour' ? 'Часы' : 'Минуты';

  return (
    <div
      ref={columnRef}
      className="ui-time-picker__column"
      role="listbox"
      aria-label={label}
      onScroll={(event) => onScroll(kind, event)}
      onPointerDown={() => onInteractionChange(true)}
      onPointerUp={() => onInteractionChange(false)}
      onPointerCancel={() => onInteractionChange(false)}
    >
      {values.map((value, index) => {
        const isSelected = value === selected;

        return (
          <button
            key={value}
            type="button"
            className={`ui-time-picker__option${isSelected ? ' ui-time-picker__option--selected' : ''}`}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(kind, index)}
          >
            {formatUnit(value)}
          </button>
        );
      })}
    </div>
  );
}

export function TimePicker({
  opened,
  value,
  onChange,
  onClose,
  target,
}: TimePickerProps) {
  const parsedValue = parseLocalTime(value);
  if (!parsedValue) throw new Error('TimePicker value must be a valid HH:mm local time');

  const hourRef = useRef<HTMLDivElement | null>(null);
  const minuteRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<LocalTimeParts>(parsedValue);
  const onChangeRef = useRef(onChange);
  const wasOpenedRef = useRef(false);
  const hourFrameRef = useRef<number | null>(null);
  const minuteFrameRef = useRef<number | null>(null);
  const interactionTimerRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<ScrollTops>({
    hour: parsedValue.hour * ROW_HEIGHT,
    minute: parsedValue.minute * ROW_HEIGHT,
  });

  const [draft, setDraft] = useState<LocalTimeParts>(parsedValue);
  const [scrollTops, setScrollTops] = useState<ScrollTops>(pendingScrollRef.current);
  const [lensAssets, setLensAssets] = useState<TimeLensAssets | null>(null);
  const [interacting, setInteracting] = useState(false);

  onChangeRef.current = onChange;

  useEffect(() => {
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
  }, [target]);

  useEffect(() => {
    if (!opened) {
      wasOpenedRef.current = false;
      setInteracting(false);
      return;
    }

    const justOpened = !wasOpenedRef.current;
    wasOpenedRef.current = true;
    if (!justOpened) return;

    draftRef.current = parsedValue;
    setDraft(parsedValue);
    const nextScrollTops = {
      hour: parsedValue.hour * ROW_HEIGHT,
      minute: parsedValue.minute * ROW_HEIGHT,
    };
    pendingScrollRef.current = nextScrollTops;
    setScrollTops(nextScrollTops);

    const view = target?.ownerDocument.defaultView ?? window;
    view.requestAnimationFrame(() => {
      scrollColumn(hourRef.current, parsedValue.hour);
      scrollColumn(minuteRef.current, parsedValue.minute);
    });
  }, [opened, parsedValue.hour, parsedValue.minute, target]);

  useEffect(() => () => {
    const view = target?.ownerDocument.defaultView ?? window;
    if (hourFrameRef.current !== null) view.cancelAnimationFrame(hourFrameRef.current);
    if (minuteFrameRef.current !== null) view.cancelAnimationFrame(minuteFrameRef.current);
    if (interactionTimerRef.current !== null) view.clearTimeout(interactionTimerRef.current);
  }, [target]);

  const commitIndex = (kind: TimeColumn, index: number) => {
    const values = kind === 'hour' ? HOUR_VALUES : MINUTE_VALUES;
    const clampedIndex = Math.max(0, Math.min(values.length - 1, index));
    const nextValue = values[clampedIndex];
    const current = draftRef.current;
    const next = kind === 'hour'
      ? { ...current, hour: nextValue }
      : { ...current, minute: nextValue };

    if (next.hour === current.hour && next.minute === current.minute) return;

    draftRef.current = next;
    setDraft(next);
    onChangeRef.current(formatLocalTime(next.hour, next.minute));
  };

  const handleScroll = (kind: TimeColumn, event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    pendingScrollRef.current = {
      ...pendingScrollRef.current,
      [kind]: top,
    };

    const frameRef = kind === 'hour' ? hourFrameRef : minuteFrameRef;
    if (frameRef.current !== null) return;

    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    setInteracting(true);
    if (interactionTimerRef.current !== null) view.clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = view.setTimeout(() => {
      interactionTimerRef.current = null;
      setInteracting(false);
    }, 140);

    frameRef.current = view.requestAnimationFrame(() => {
      frameRef.current = null;
      const nextTop = pendingScrollRef.current[kind];
      setScrollTops((current) => ({ ...current, [kind]: nextTop }));
      commitIndex(kind, Math.round(nextTop / ROW_HEIGHT));
    });
  };

  const handleSelect = (kind: TimeColumn, index: number) => {
    commitIndex(kind, index);
    scrollColumn(kind === 'hour' ? hourRef.current : minuteRef.current, index, true);
  };

  return (
    <MezfitPopover
      opened={opened}
      target={target ?? undefined}
      angle={false}
      backdrop
      onBackdropClick={onClose}
      className="ui-time-picker__popover"
      style={{ width: '312px', maxWidth: 'calc(100vw - 24px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Выбор времени"
    >
      <div className="ui-time-picker">
        <div className="ui-time-picker__wheel">
          <div className="ui-time-picker__columns">
            <TimeColumnWheel
              kind="hour"
              values={HOUR_VALUES}
              selected={draft.hour}
              onScroll={handleScroll}
              onSelect={handleSelect}
              onInteractionChange={setInteracting}
              columnRef={hourRef}
            />
            <span className="ui-time-picker__separator" aria-hidden="true">:</span>
            <TimeColumnWheel
              kind="minute"
              values={MINUTE_VALUES}
              selected={draft.minute}
              onScroll={handleScroll}
              onSelect={handleSelect}
              onInteractionChange={setInteracting}
              columnRef={minuteRef}
            />
          </div>

          <TimeLens assets={lensAssets} scrollTops={scrollTops} active={interacting} />
          <div className="ui-time-picker__fade ui-time-picker__fade--top" aria-hidden="true" />
          <div className="ui-time-picker__fade ui-time-picker__fade--bottom" aria-hidden="true" />
        </div>
      </div>
    </MezfitPopover>
  );
}

export type { LocalTime };
