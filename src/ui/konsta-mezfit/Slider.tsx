// Konsta 5.4.0 Mezfit edition: preserve Range/native input mechanics; replace only the visual track and thumb.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Range as KonstaRange } from 'konsta/react';
import './Slider.css';

export type MezfitSliderSize = 'big' | 'medium' | 'small';

export type MezfitSliderProps = {
  size: MezfitSliderSize;
  start: number;
  end: number;
  onValueChange?: (value: number) => void;
};

type SliderCssProperties = CSSProperties & {
  '--mezfit-slider-width': string;
  '--mezfit-slider-height': string;
  '--mezfit-slider-track-height': string;
  '--mezfit-slider-track-radius': string;
  '--mezfit-slider-thumb-width': string;
  '--mezfit-slider-thumb-height': string;
  '--mezfit-slider-thumb-radius': string;
  '--mezfit-slider-thumb-left': string;
  '--mezfit-slider-shadow-y': string;
  '--mezfit-slider-shadow-blur': string;
};

const SIZE_SCALE: Record<MezfitSliderSize, number> = {
  big: 1,
  medium: 0.75,
  small: 0.5,
};

const BASE_TRACK_WIDTH = 330;
const BASE_TRACK_HEIGHT = 21;
const BASE_THUMB_WIDTH = 90;
const BASE_THUMB_HEIGHT = 60;
const BASE_THUMB_RADIUS = 30;
const REST_SCALE = 0.6;
const ACTIVE_SCALE = 1;
const REST_REFRACTION_MULTIPLIER = 0.4;
const ACTIVE_REFRACTION_MULTIPLIER = 0.9;
const SPECULAR_OPACITY = 0.4;
const SPECULAR_SATURATION = 7;
const BASE_MAX_DISPLACEMENT = 83.88118841653394;

// Precomputed with the exact Kube slider optics: 90x60, radius 30, bezel 16,
// glass thickness 80, refractive index 1.45, convex_squircle, DPR 2.
const DISPLACEMENT_MAP = "data:image/png;base64,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";
const SPECULAR_MAP = "data:image/png;base64,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";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function MezfitSlider({ size, start, end, onValueChange }: MezfitSliderProps) {
  const scale = SIZE_SCALE[size];
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const isStatic = min === max;
  // Konsta 5.4.0 calculates thumb position by dividing by (max - min), even
  // while disabled. Keep its private interaction range non-zero for a static
  // slider without changing the public Start/End/Value semantics.
  const interactionMax = isStatic ? min + 1 : max;
  const [value, setValue] = useState(() => clamp(start, min, max));
  const [isActive, setIsActive] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(BASE_TRACK_WIDTH * scale);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId().replace(/:/g, '');
  const filterId = `mezfit-slider-optics-${reactId}`;

  const trackHeight = BASE_TRACK_HEIGHT * scale;
  const thumbWidth = BASE_THUMB_WIDTH * scale;
  const thumbHeight = BASE_THUMB_HEIGHT * scale;
  const thumbRadius = BASE_THUMB_RADIUS * scale;
  const restThumbWidth = thumbWidth * REST_SCALE;
  const range = max - min;
  const ratio = range === 0 ? 0 : clamp((value - min) / range, 0, 1);
  const thumbTravel = Math.max(0, measuredWidth - restThumbWidth);
  const thumbOversize = (thumbWidth - restThumbWidth) / 2;
  const thumbLeft = ratio * thumbTravel - thumbOversize;
  const refractionMultiplier = isActive
    ? ACTIVE_REFRACTION_MULTIPLIER
    : REST_REFRACTION_MULTIPLIER;
  const displacementScale = BASE_MAX_DISPLACEMENT * scale * refractionMultiplier;

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const width = element.offsetWidth || element.getBoundingClientRect().width;
      if (width > 0) setMeasuredWidth(width);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scale]);

  useEffect(() => {
    setValue(current => clamp(current, min, max));
  }, [min, max]);

  useEffect(() => {
    if (!isActive) return undefined;

    const stop = () => setIsActive(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [isActive]);

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    const nextValue = clamp(Number(event.currentTarget.value), min, max);
    setValue(nextValue);
    onValueChange?.(nextValue);
  };

  const handlePointerDown = () => {
    if (!isStatic) setIsActive(true);
  };

  const sliderStyle: SliderCssProperties = {
    '--mezfit-slider-width': `${BASE_TRACK_WIDTH * scale}px`,
    '--mezfit-slider-height': `${thumbHeight}px`,
    '--mezfit-slider-track-height': `${trackHeight}px`,
    '--mezfit-slider-track-radius': `${trackHeight / 2}px`,
    '--mezfit-slider-thumb-width': `${thumbWidth}px`,
    '--mezfit-slider-thumb-height': `${thumbHeight}px`,
    '--mezfit-slider-thumb-radius': `${thumbRadius}px`,
    '--mezfit-slider-thumb-left': `${thumbLeft}px`,
    '--mezfit-slider-shadow-y': `${3 * scale}px`,
    '--mezfit-slider-shadow-blur': `${14 * scale}px`,
  };

  return (
    <div
      ref={rootRef}
      className="mezfit-slider"
      data-size={size}
      data-value={value}
      style={sliderStyle}
      onPointerDownCapture={handlePointerDown}
      onPointerUpCapture={() => setIsActive(false)}
      onPointerCancelCapture={() => setIsActive(false)}
    >
      <div className="mezfit-slider__track" aria-hidden="true">
        <div className="mezfit-slider__track-clip">
          <div className="mezfit-slider__fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>

      <KonstaRange
        className="mezfit-slider__input-layer"
        min={min}
        max={interactionMax}
        step="any"
        value={value}
        disabled={isStatic}
        onInput={handleInput}
      />

      <div
        className={`mezfit-slider__thumb-layout${isActive ? ' is-active' : ''}`}
        aria-hidden="true"
      >
        <div
          className="mezfit-slider__thumb"
          style={{
            backdropFilter: `url(#${filterId})`,
            WebkitBackdropFilter: `url(#${filterId})`,
            transform: `scale(${isActive ? ACTIVE_SCALE : REST_SCALE})`,
          }}
        />
      </div>

      <svg className="mezfit-slider__filter" aria-hidden="true" colorInterpolationFilters="sRGB">
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blurred_source" />
            <feImage
              href={DISPLACEMENT_MAP}
              x="0"
              y="0"
              width={thumbWidth}
              height={thumbHeight}
              preserveAspectRatio="none"
              result="displacement_map"
            />
            <feDisplacementMap
              data-mezfit-slider-displacement="true"
              in="blurred_source"
              in2="displacement_map"
              scale={displacementScale}
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feColorMatrix
              in="displaced"
              type="saturate"
              values={SPECULAR_SATURATION}
              result="displaced_saturated"
            />
            <feImage
              href={SPECULAR_MAP}
              x="0"
              y="0"
              width={thumbWidth}
              height={thumbHeight}
              preserveAspectRatio="none"
              result="specular_layer"
            />
            <feComposite
              in="displaced_saturated"
              in2="specular_layer"
              operator="in"
              result="specular_saturated"
            />
            <feComponentTransfer in="specular_layer" result="specular_faded">
              <feFuncA type="linear" slope={SPECULAR_OPACITY} />
            </feComponentTransfer>
            <feBlend
              in="specular_saturated"
              in2="displaced"
              mode="normal"
              result="withSaturation"
            />
            <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}

MezfitSlider.displayName = 'MezfitSlider';
