import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';

export type StandaloneLiquidGlassIconOnlyStartupItem = {
  value: string;
  icon: { outline: ReactElement; filled: ReactElement };
};

export type LiquidGlassIconOnlyStartupState = 'hidden' | 'revealing' | 'visible';

type LiquidGlassIconOnlyStartupArgs = {
  enabled: boolean;
  hidden: boolean;
  items: readonly StandaloneLiquidGlassIconOnlyStartupItem[];
  activeValue?: string;
  listRef: RefObject<HTMLDivElement | null>;
};

const STARTUP_DURATION_MS = 580;
const STARTUP_CURVE_DURATION_MS = 1200;
const STARTUP_OPEN_FRACTION = .21;
const STARTUP_LOW_FRACTION = .75;
const STARTUP_HEIGHT_PX = 64;
const STARTUP_INITIAL_HEIGHT_PERCENT = 80;
const STARTUP_LOW_PX = 19;
const STARTUP_SPRING_MS = 230;

export const LIQUID_GLASS_ICON_ONLY_STARTUP_PRESET = Object.freeze({
  durationMs: STARTUP_DURATION_MS,
  curveDurationMs: STARTUP_CURVE_DURATION_MS,
  openFraction: STARTUP_OPEN_FRACTION,
  lowFraction: STARTUP_LOW_FRACTION,
  initialHeightPercent: STARTUP_INITIAL_HEIGHT_PERCENT,
  lowPx: STARTUP_LOW_PX,
  springMs: STARTUP_SPRING_MS,
});

const STARTUP_ZOOM = Object.freeze({
  width: 132,
  strengthX: 12,
  strengthY: 17.5,
  edgeOffset: 0,
  padding: 160,
  exitMs: 280,
  nodes: [
    { x: 0, y: 0 },
    { x: .21, y: .88 },
    { x: .47, y: 1 },
    { x: .78, y: .88 },
    { x: 1, y: 0 },
  ],
});

const SCALE_X_NODES = [
  { t: 0, s: 1.25 },
  { t: 330, s: 1.18 },
  { t: 779.7970246696906, s: 1.0809331587587891 },
  { t: 1200, s: 1 },
];

const SCALE_X_CONTROLS = [
  [{ t: 90, s: 1.25 }, { t: 230, s: 1.22 }],
  [{ t: 450, s: 1.14 }, { t: 693.8062003295811, s: 0.8612479021258022 }],
  [{ t: 889.7970246696907, s: 1.055933158758789 }, { t: 1110, s: 1 }],
];

const SCALE_Y_NODES = [
  { t: 0, s: 1.25 },
  { t: 330, s: 1.18 },
  { t: 878.825189690977, s: .8 },
  { t: 1200, s: 1 },
];

const SCALE_Y_CONTROLS = [
  [{ t: 90, s: 1.25 }, { t: 230, s: 1.22 }],
  [{ t: 450, s: 1.14 }, { t: 738.825189690977, s: 0.8300000000000001 }],
  [{ t: 988.8251896909766, s: .8 }, { t: 1110, s: 1 }],
];

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function cubicBezier(a: number, b: number, c: number, d: number, progress: number) {
  const inverse = 1 - progress;
  return inverse * inverse * inverse * a
    + 3 * inverse * inverse * progress * b
    + 3 * inverse * progress * progress * c
    + progress * progress * progress * d;
}

function sampleCurve(
  nodes: readonly { t: number; s: number }[],
  controls: readonly (readonly { t: number; s: number }[])[],
  time: number,
) {
  let segment = 0;
  while (segment < 2 && time > nodes[segment + 1].t) segment += 1;

  const from = nodes[segment];
  const to = nodes[segment + 1];
  const handles = controls[segment];
  let low = 0;
  let high = 1;
  let progress = .5;

  for (let index = 0; index < 20; index += 1) {
    progress = (low + high) / 2;
    if (cubicBezier(from.t, handles[0].t, handles[1].t, to.t, progress) < time) low = progress;
    else high = progress;
  }

  return cubicBezier(from.s, handles[0].s, handles[1].s, to.s, progress);
}

function catmull(v0: number, v1: number, v2: number, v3: number, progress: number) {
  const p2 = progress * progress;
  const p3 = p2 * progress;
  return .5 * (
    (2 * v1)
    + (-v0 + v2) * progress
    + (2 * v0 - 5 * v1 + 4 * v2 - v3) * p2
    + (-v0 + 3 * v1 - 3 * v2 + v3) * p3
  );
}

function profileSample(x: number) {
  const nodes = STARTUP_ZOOM.nodes;
  const normalized = clamp(x, 0, 1);
  let index = 0;
  while (index < nodes.length - 2 && normalized > nodes[index + 1].x) index += 1;
  const a = nodes[Math.max(0, index - 1)];
  const b = nodes[index];
  const c = nodes[index + 1];
  const d = nodes[Math.min(nodes.length - 1, index + 2)];
  const span = Math.max(.0001, c.x - b.x);
  return catmull(a.y, b.y, c.y, d.y, clamp((normalized - b.x) / span, 0, 1));
}

function startupTimelineDuration() {
  return STARTUP_DURATION_MS + Math.max(STARTUP_ZOOM.exitMs, STARTUP_SPRING_MS);
}

function startupWidthKeyframes(fullWidth: number) {
  const remaining = Math.max(.001, STARTUP_LOW_FRACTION - STARTUP_OPEN_FRACTION);
  return [
    { offset: 0, width: '64px' },
    { offset: STARTUP_OPEN_FRACTION, width: '64px' },
    { offset: STARTUP_OPEN_FRACTION + remaining * .30, width: `${64 + (fullWidth - 64) * .22}px` },
    { offset: STARTUP_OPEN_FRACTION + remaining * .62, width: `${64 + (fullWidth - 64) * .62}px` },
    { offset: STARTUP_OPEN_FRACTION + remaining * .92, width: `${64 + (fullWidth - 64) * .94}px` },
    { offset: STARTUP_LOW_FRACTION, width: `${fullWidth}px` },
    { offset: 1, width: `${fullWidth}px` },
  ];
}

function createNeutralCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = 'rgb(128,128,128)';
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function buildZoomMap(fullWidth: number, visibleWidth: number, elapsedMs: number) {
  const width = Math.max(64, Math.round(fullWidth));
  const height = STARTUP_HEIGHT_PX;
  const neutral = createNeutralCanvas(width, height);
  if (!neutral) return null;

  const lowTime = STARTUP_DURATION_MS * STARTUP_LOW_FRACTION;
  const halfLens = STARTUP_ZOOM.width / 2;
  let leftCenter: number;
  let rightCenter: number;

  if (elapsedMs <= lowTime) {
    const edge = visibleWidth / 2;
    leftCenter = -edge - STARTUP_ZOOM.edgeOffset;
    rightCenter = edge + STARTUP_ZOOM.edgeOffset;
  } else {
    const startLeft = -fullWidth / 2 - STARTUP_ZOOM.edgeOffset;
    const startRight = fullWidth / 2 + STARTUP_ZOOM.edgeOffset;
    const exitDistance = fullWidth / 2 + halfLens + 16;
    const travelDuration = Math.max(1, (STARTUP_DURATION_MS - lowTime) + STARTUP_ZOOM.exitMs);
    const progress = clamp((elapsedMs - lowTime) / travelDuration, 0, 1);
    leftCenter = startLeft + (-exitDistance - startLeft) * progress;
    rightCenter = startRight + (exitDistance - startRight) * progress;
  }

  const image = neutral.context.createImageData(width, height);
  const pixels = image.data;
  const centerY = height / 2;
  const radiusX = Math.max(1, STARTUP_ZOOM.width / 2);
  const radiusY = height / 2;
  const centers = [width / 2 + leftCenter, width / 2 + rightCenter];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let displacementX = 0;
      let displacementY = 0;

      for (const centerX of centers) {
        const normalizedX = (x + .5 - centerX) / radiusX;
        const normalizedY = (y + .5 - centerY) / Math.max(1, radiusY);
        const radius = Math.hypot(normalizedX, normalizedY);
        if (radius > 1) continue;

        const amplitude = profileSample(radius);
        const unitX = radius > 1e-5 ? normalizedX / radius : 0;
        const unitY = radius > 1e-5 ? normalizedY / radius : 0;
        displacementX += -unitX * amplitude * STARTUP_ZOOM.strengthX;
        displacementY += -unitY * amplitude * STARTUP_ZOOM.strengthY;
      }

      const pixel = (y * width + x) * 4;
      pixels[pixel] = Math.round(clamp(128 + displacementX / 64 * 255, 0, 255));
      pixels[pixel + 1] = Math.round(clamp(128 + displacementY / 64 * 255, 0, 255));
      pixels[pixel + 2] = 128;
      pixels[pixel + 3] = 255;
    }
  }

  neutral.context.putImageData(image, 0, 0);
  return neutral.canvas.toDataURL('image/png');
}

export function useStandaloneLiquidGlassIconOnlyStartup({
  enabled,
  hidden,
  items,
  activeValue,
  listRef,
}: LiquidGlassIconOnlyStartupArgs) {
  const [state, setState] = useState<LiquidGlassIconOnlyStartupState>(() => (
    enabled && hidden ? 'hidden' : 'visible'
  ));
  const previousHiddenRef = useRef(hidden);
  const generationRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const widthAnimationsRef = useRef<Animation[]>([]);
  const motionRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const imageRef = useRef<SVGFEImageElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const filterId = `lgio-startup-${useId().replace(/:/g, '')}`;

  useLayoutEffect(() => {
    const previousHidden = previousHiddenRef.current;
    previousHiddenRef.current = hidden;

    const cancel = () => {
      generationRef.current += 1;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      widthAnimationsRef.current.forEach((animation) => animation.cancel());
      widthAnimationsRef.current = [];
    };

    if (!enabled) {
      cancel();
      setState('visible');
      return cancel;
    }

    if (hidden) {
      cancel();
      setState('hidden');
      return cancel;
    }

    if (!previousHidden) {
      setState('visible');
      return cancel;
    }

    const list = listRef.current;
    const motion = motionRef.current;
    const shape = shapeRef.current;
    const mask = maskRef.current;
    const strip = stripRef.current;
    const filter = filterRef.current;
    const image = imageRef.current;
    const displacement = displacementRef.current;

    if (!list || !motion || !shape || !mask || !strip || !filter || !image || !displacement) {
      setState('visible');
      return cancel;
    }

    const fullWidth = Math.max(64, list.getBoundingClientRect().width || list.offsetWidth || 64);
    strip.style.width = `${fullWidth}px`;
    shape.style.width = '64px';
    mask.style.width = '64px';
    shape.style.height = `${STARTUP_HEIGHT_PX}px`;
    mask.style.height = `${STARTUP_HEIGHT_PX}px`;
    strip.style.opacity = '0';
    setState('revealing');

    const keyframes = startupWidthKeyframes(fullWidth);
    widthAnimationsRef.current = [
      shape.animate(keyframes, { duration: STARTUP_DURATION_MS, easing: 'linear', fill: 'forwards' }),
      mask.animate(keyframes, { duration: STARTUP_DURATION_MS, easing: 'linear', fill: 'forwards' }),
    ];

    const generation = ++generationRef.current;
    const total = startupTimelineDuration();
    const startedAt = performance.now();

    const renderFrame = (elapsed: number) => {
      const clamped = clamp(elapsed, 0, total);
      const curveTime = clamped <= STARTUP_DURATION_MS
        ? clamped / STARTUP_DURATION_MS * STARTUP_CURVE_DURATION_MS
        : STARTUP_CURVE_DURATION_MS;

      let scaleX = sampleCurve(SCALE_X_NODES, SCALE_X_CONTROLS, curveTime);
      let scaleY = sampleCurve(SCALE_Y_NODES, SCALE_Y_CONTROLS, curveTime);

      if (clamped > STARTUP_DURATION_MS) {
        const springProgress = clamp(
          (clamped - STARTUP_DURATION_MS) / Math.max(1, STARTUP_SPRING_MS),
          0,
          1,
        );
        const springScale = springProgress <= .5
          ? 1 - .04 * (springProgress / .5)
          : .96 + .04 * ((springProgress - .5) / .5);
        scaleX = springScale;
        scaleY = springScale;
      }

      shape.style.transform = `translate(-50%,-50%) scale(${scaleX}, ${scaleY})`;
      mask.style.transform = `translate(-50%,-50%) scale(${scaleX}, ${scaleY})`;

      if (clamped <= STARTUP_DURATION_MS) {
        const lowTime = Math.max(1, STARTUP_DURATION_MS * STARTUP_LOW_FRACTION);
        const startY = -(STARTUP_INITIAL_HEIGHT_PERCENT / 100 * STARTUP_HEIGHT_PX + STARTUP_HEIGHT_PX / 2);
        const y = clamped <= lowTime
          ? startY + (STARTUP_LOW_PX - startY) * clamp(clamped / lowTime, 0, 1)
          : STARTUP_LOW_PX * (1 - clamp((clamped - lowTime) / Math.max(1, STARTUP_DURATION_MS - lowTime), 0, 1));
        motion.style.transform = `translateY(${y}px)`;
      } else {
        motion.style.transform = 'translateY(0px)';
      }

      strip.style.opacity = clamped >= STARTUP_DURATION_MS * STARTUP_OPEN_FRACTION ? '1' : '0';

      const visibleWidth = Math.max(64, Number.parseFloat(getComputedStyle(mask).width) || 64);
      const mapUrl = buildZoomMap(fullWidth, visibleWidth, clamped);
      if (mapUrl) {
        image.setAttribute('href', mapUrl);
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
        image.setAttribute('width', String(Math.round(fullWidth)));
        image.setAttribute('height', String(STARTUP_HEIGHT_PX));
      }
      const padding = Math.max(100, STARTUP_ZOOM.padding);
      filter.setAttribute('x', `${-padding}%`);
      filter.setAttribute('y', `${-padding}%`);
      filter.setAttribute('width', `${100 + padding * 2}%`);
      filter.setAttribute('height', `${100 + padding * 2}%`);
      displacement.setAttribute('scale', '64');
    };

    renderFrame(0);

    const tick = (now: number) => {
      if (generation !== generationRef.current) return;
      const elapsed = Math.min(total, now - startedAt);
      renderFrame(elapsed);

      if (elapsed < total) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      rafRef.current = null;
      setState('visible');
    };

    rafRef.current = requestAnimationFrame(tick);
    return cancel;
  }, [enabled, hidden, listRef]);

  const activeIndex = Math.max(0, items.findIndex((item) => item.value === activeValue));
  const selectorWidth = items.length > 0 ? 100 / items.length : 100;

  const overlay: ReactNode = enabled ? (
    <div className="ui-liquid-glass-icon-only__startup" aria-hidden="true">
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <filter ref={filterRef} id={filterId} colorInterpolationFilters="sRGB">
          <feImage ref={imageRef} x="0" y="0" width="64" height="64" preserveAspectRatio="none" result="zoomMap" />
          <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="zoomMap" scale="64" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div ref={motionRef} className="ui-liquid-glass-icon-only__startup-motion">
        <div className="ui-liquid-glass-icon-only__startup-scale">
          <div ref={shapeRef} className="ui-liquid-glass-icon-only__startup-shape" />
          <div ref={maskRef} className="ui-liquid-glass-icon-only__startup-mask">
            <div
              ref={stripRef}
              className="ui-liquid-glass-icon-only__startup-strip"
              style={{ '--lgio-startup-filter': `url(#${filterId})` } as CSSProperties}
            >
              {items.map((item, index) => (
                <span
                  key={item.value}
                  className={`ui-liquid-glass-icon-only__startup-item${index === activeIndex ? ' is-active' : ''}`}
                >
                  <span className="ui-liquid-glass-icon-only__startup-icon ui-liquid-glass-icon-only__startup-icon--outline">{item.icon.outline}</span>
                  <span className="ui-liquid-glass-icon-only__startup-icon ui-liquid-glass-icon-only__startup-icon--filled">{item.icon.filled}</span>
                </span>
              ))}
              <span
                className="ui-liquid-glass-icon-only__startup-selector"
                style={{ width: `${selectorWidth}%`, transform: `translateX(${activeIndex * 100}%)` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { state, overlay };
}
