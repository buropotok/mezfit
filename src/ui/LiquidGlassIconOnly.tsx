import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import './LiquidGlassIconOnly.css';

export type LiquidGlassIconOnlyTab = {
  value: string;
  label: string;
  icon: {
    outline: ReactNode;
    filled: ReactNode;
  };
};

export type LiquidGlassIconOnlyProps = {
  tabs: readonly LiquidGlassIconOnlyTab[];
  value: string;
  onValueChange: (value: string) => void;
  hidden: boolean;
};

type Phase = 'hidden' | 'revealing' | 'visible';
type Gesture = 'idle' | 'pending' | 'scroll' | 'press';

const HEIGHT = 64;
const HOLD_DELAY_MS = 140;
const LENS_EXPAND_MS = 300;
const TRAVEL_MS = 300;
const PANE_SCALE = 1.05;
const LENS_SCALE = 1.25;
const ACTIVE_ICON_SPRING_MS = 1110;

const STARTUP = Object.freeze({
  duration: 580,
  curveDuration: 1200,
  openFraction: .21,
  lowFraction: .75,
  startPercent: 80,
  lowPx: 19,
  springMs: 230,
  zoom: {
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
  },
});

const SCALE_X_NODES = [
  { t: 0, s: 1.25 },
  { t: 330, s: 1.18 },
  { t: 779.7970246696906, s: 1.0809331587587891 },
  { t: 1200, s: 1 },
] as const;

const SCALE_X_CONTROLS = [
  [{ t: 90, s: 1.25 }, { t: 230, s: 1.22 }],
  [{ t: 450, s: 1.14 }, { t: 693.8062003295811, s: 0.8612479021258022 }],
  [{ t: 889.7970246696907, s: 1.055933158758789 }, { t: 1110, s: 1 }],
] as const;

const SCALE_Y_NODES = [
  { t: 0, s: 1.25 },
  { t: 330, s: 1.18 },
  { t: 878.825189690977, s: .8 },
  { t: 1200, s: 1 },
] as const;

const SCALE_Y_CONTROLS = [
  [{ t: 90, s: 1.25 }, { t: 230, s: 1.22 }],
  [{ t: 450, s: 1.14 }, { t: 738.825189690977, s: .8300000000000001 }],
  [{ t: 988.8251896909766, s: .8 }, { t: 1110, s: 1 }],
] as const;

const SPRING = Object.freeze({
  duration: 600,
  lead: 90,
  p1Time: 78,
  p2Time: 479,
  x1: .92,
  x2: 1.02,
  y1: 1.09,
  y2: .99,
  xBend1: .88,
  xBend2: 1.03,
  yBend1: 1.14,
  yBend2: .98,
});

const OPTICS = Object.freeze({
  neutralEdge: 1.7,
  rimWidth: 8,
  rimStrength: .67,
  trenchWidth: 1,
  trenchStrength: .09,
  refraction: 8,
  rgbSpread: .1,
  padding: 51,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function cubicBezier(a: number, b: number, c: number, d: number, progress: number) {
  const inverse = 1 - progress;
  return inverse ** 3 * a
    + 3 * inverse ** 2 * progress * b
    + 3 * inverse * progress ** 2 * c
    + progress ** 3 * d;
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
    2 * v1
    + (-v0 + v2) * progress
    + (2 * v0 - 5 * v1 + 4 * v2 - v3) * p2
    + (-v0 + 3 * v1 - 3 * v2 + v3) * p3
  );
}

function startupProfile(x: number) {
  const nodes = STARTUP.zoom.nodes;
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
  return STARTUP.duration + Math.max(STARTUP.zoom.exitMs, STARTUP.springMs);
}

function startupWidthKeyframes(fullWidth: number) {
  const remaining = STARTUP.lowFraction - STARTUP.openFraction;
  return [
    { offset: 0, width: '64px' },
    { offset: STARTUP.openFraction, width: '64px' },
    { offset: STARTUP.openFraction + remaining * .30, width: `${64 + (fullWidth - 64) * .22}px` },
    { offset: STARTUP.openFraction + remaining * .62, width: `${64 + (fullWidth - 64) * .62}px` },
    { offset: STARTUP.openFraction + remaining * .92, width: `${64 + (fullWidth - 64) * .94}px` },
    { offset: STARTUP.lowFraction, width: `${fullWidth}px` },
    { offset: 1, width: `${fullWidth}px` },
  ];
}

function buildStartupMap(fullWidth: number, visibleWidth: number, elapsed: number) {
  const width = Math.max(64, Math.round(fullWidth));
  const height = HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const lowTime = STARTUP.duration * STARTUP.lowFraction;
  const halfLens = STARTUP.zoom.width / 2;
  let leftCenter: number;
  let rightCenter: number;
  if (elapsed <= lowTime) {
    const edge = visibleWidth / 2;
    leftCenter = -edge - STARTUP.zoom.edgeOffset;
    rightCenter = edge + STARTUP.zoom.edgeOffset;
  } else {
    const startLeft = -fullWidth / 2 - STARTUP.zoom.edgeOffset;
    const startRight = fullWidth / 2 + STARTUP.zoom.edgeOffset;
    const exitDistance = fullWidth / 2 + halfLens + 16;
    const travelDuration = Math.max(1, (STARTUP.duration - lowTime) + STARTUP.zoom.exitMs);
    const progress = clamp((elapsed - lowTime) / travelDuration, 0, 1);
    leftCenter = startLeft + (-exitDistance - startLeft) * progress;
    rightCenter = startRight + (exitDistance - startRight) * progress;
  }

  const image = context.createImageData(width, height);
  const pixels = image.data;
  const centerY = height / 2;
  const radiusX = Math.max(1, STARTUP.zoom.width / 2);
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
        const amplitude = startupProfile(radius);
        const unitX = radius > 1e-5 ? normalizedX / radius : 0;
        const unitY = radius > 1e-5 ? normalizedY / radius : 0;
        displacementX += -unitX * amplitude * STARTUP.zoom.strengthX;
        displacementY += -unitY * amplitude * STARTUP.zoom.strengthY;
      }
      const pixel = (y * width + x) * 4;
      pixels[pixel] = Math.round(clamp(128 + displacementX / 64 * 255, 0, 255));
      pixels[pixel + 1] = Math.round(clamp(128 + displacementY / 64 * 255, 0, 255));
      pixels[pixel + 2] = 128;
      pixels[pixel + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function roundedRectSdf(x: number, y: number, halfWidth: number, halfHeight: number, radius: number) {
  const qx = Math.abs(x) - (halfWidth - radius);
  const qy = Math.abs(y) - (halfHeight - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

function springHandleTime(index: 1 | 2) {
  if (index === 1) {
    const room = SPRING.p2Time - SPRING.p1Time;
    return SPRING.p1Time + Math.min(46, Math.max(18, room * .34));
  }
  const room = SPRING.duration - SPRING.p2Time;
  return SPRING.p2Time + Math.min(46, Math.max(18, room * .42));
}

function springTangent(axis: 'x' | 'y', index: 1 | 2) {
  const value = axis === 'x'
    ? index === 1 ? SPRING.x1 : SPRING.x2
    : index === 1 ? SPRING.y1 : SPRING.y2;
  const bend = axis === 'x'
    ? index === 1 ? SPRING.xBend1 : SPRING.xBend2
    : index === 1 ? SPRING.yBend1 : SPRING.yBend2;
  const pointTime = index === 1 ? SPRING.p1Time : SPRING.p2Time;
  return (bend - value) / Math.max(1, springHandleTime(index) - pointTime);
}

function hermite(time: number, t0: number, y0: number, m0: number, t1: number, y1: number, m1: number) {
  const duration = Math.max(1, t1 - t0);
  const progress = clamp((time - t0) / duration, 0, 1);
  const p2 = progress * progress;
  const p3 = p2 * progress;
  return (2 * p3 - 3 * p2 + 1) * y0
    + (p3 - 2 * p2 + progress) * duration * m0
    + (-2 * p3 + 3 * p2) * y1
    + (p3 - p2) * duration * m1;
}

function springValue(axis: 'x' | 'y', time: number) {
  const first = axis === 'x' ? SPRING.x1 : SPRING.y1;
  const second = axis === 'x' ? SPRING.x2 : SPRING.y2;
  const firstTangent = springTangent(axis, 1);
  const secondTangent = springTangent(axis, 2);
  if (time <= SPRING.p1Time) return hermite(time, 0, 1, 0, SPRING.p1Time, first, firstTangent);
  if (time <= SPRING.p2Time) return hermite(time, SPRING.p1Time, first, firstTangent, SPRING.p2Time, second, secondTangent);
  return hermite(time, SPRING.p2Time, second, secondTangent, SPRING.duration, 1, 0);
}

function springKeyframes() {
  const samples = 64;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const time = SPRING.duration * (index / samples);
    return {
      transform: `scale(${springValue('x', time).toFixed(4)}, ${springValue('y', time).toFixed(4)})`,
      offset: index / samples,
    };
  });
}

function activeIconKeyframes() {
  return [
    { transform: 'scale(1)', offset: 0, easing: 'cubic-bezier(.18,.75,.22,1)' },
    { transform: 'scale(1.16)', offset: .16, easing: 'cubic-bezier(.16,.9,.22,1)' },
    { transform: 'scale(.94)', offset: .34, easing: 'cubic-bezier(.20,.82,.26,1)' },
    { transform: 'scale(1.055)', offset: .53, easing: 'cubic-bezier(.18,.82,.24,1)' },
    { transform: 'scale(.985)', offset: .72, easing: 'cubic-bezier(.2,.78,.25,1)' },
    { transform: 'scale(1.012)', offset: .86, easing: 'ease-out' },
    { transform: 'scale(1)', offset: 1 },
  ];
}

function safeFilterId(id: string) {
  return id.replace(/:/g, '');
}

export function LiquidGlassIconOnly({ tabs, value, onValueChange, hidden }: LiquidGlassIconOnlyProps) {
  const resolvedActiveIndex = tabs.length === 0
    ? -1
    : Math.max(0, tabs.findIndex((tab) => tab.value === value));
  const initialPhase = useRef<Phase>(hidden ? 'hidden' : 'visible');
  const [phase, setPhase] = useState<Phase>(initialPhase.current);
  const previousHiddenRef = useRef(hidden);
  const rootRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const selectorTrackRef = useRef<HTMLSpanElement>(null);
  const selectorRef = useRef<HTMLSpanElement>(null);
  const lensTrackRef = useRef<HTMLSpanElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  const startupMotionRef = useRef<HTMLDivElement>(null);
  const startupShapeRef = useRef<HTMLDivElement>(null);
  const startupMaskRef = useRef<HTMLDivElement>(null);
  const startupStripRef = useRef<HTMLDivElement>(null);
  const startupImageRef = useRef<SVGFEImageElement>(null);
  const startupFilterRef = useRef<SVGFilterElement>(null);
  const opticalImageRef = useRef<SVGFEImageElement>(null);
  const opticalFilterRef = useRef<SVGFilterElement>(null);
  const opticalRRef = useRef<SVGFEDisplacementMapElement>(null);
  const opticalGRef = useRef<SVGFEDisplacementMapElement>(null);
  const opticalBRef = useRef<SVGFEDisplacementMapElement>(null);
  const activeValueRef = useRef(value);
  const tabsRef = useRef(tabs);
  const activeIndexRef = useRef(resolvedActiveIndex);
  const internalSelectionRef = useRef<string | null>(null);
  const onValueChangeRef = useRef(onValueChange);
  const startupFilterId = safeFilterId(`${useId()}-lgio-startup`);
  const opticalFilterId = safeFilterId(`${useId()}-lgio-optical`);

  useEffect(() => {
    activeValueRef.current = value;
    tabsRef.current = tabs;
    onValueChangeRef.current = onValueChange;
  }, [onValueChange, tabs, value]);

  useLayoutEffect(() => {
    const previousHidden = previousHiddenRef.current;
    previousHiddenRef.current = hidden;
    if (hidden) {
      setPhase('hidden');
      return;
    }
    if (previousHidden) {
      setPhase('revealing');
      return;
    }
    setPhase((current) => current === 'hidden' ? 'visible' : current);
  }, [hidden]);

  useLayoutEffect(() => {
    if (phase !== 'revealing' || hidden) return undefined;
    if (tabs.length === 0) {
      setPhase('visible');
      return undefined;
    }
    const root = rootRef.current;
    const motion = startupMotionRef.current;
    const shape = startupShapeRef.current;
    const mask = startupMaskRef.current;
    const strip = startupStripRef.current;
    const image = startupImageRef.current;
    const filter = startupFilterRef.current;
    if (!root || !motion || !shape || !mask || !strip || !image || !filter) {
      setPhase('visible');
      return undefined;
    }

    let raf = 0;
    let cancelled = false;
    const animations: Animation[] = [];
    const fullWidth = Math.max(64, root.getBoundingClientRect().width || root.offsetWidth || 64);
    strip.style.width = `${fullWidth}px`;
    strip.style.opacity = '0';
    motion.style.transform = `translateY(${-((STARTUP.startPercent / 100) * HEIGHT + HEIGHT / 2)}px)`;
    shape.style.width = '64px';
    mask.style.width = '64px';
    shape.style.height = `${HEIGHT}px`;
    mask.style.height = `${HEIGHT}px`;

    const keyframes = startupWidthKeyframes(fullWidth);
    if (typeof shape.animate === 'function') {
      animations.push(
        shape.animate(keyframes, { duration: STARTUP.duration, easing: 'linear', fill: 'forwards' }),
        mask.animate(keyframes, { duration: STARTUP.duration, easing: 'linear', fill: 'forwards' }),
      );
    }

    const total = startupTimelineDuration();
    const start = performance.now();
    const render = (elapsed: number) => {
      const time = clamp(elapsed, 0, total);
      const curveTime = time <= STARTUP.duration
        ? time / STARTUP.duration * STARTUP.curveDuration
        : STARTUP.curveDuration;
      let scaleX = sampleCurve(SCALE_X_NODES, SCALE_X_CONTROLS, curveTime);
      let scaleY = sampleCurve(SCALE_Y_NODES, SCALE_Y_CONTROLS, curveTime);
      if (time > STARTUP.duration) {
        const springProgress = clamp((time - STARTUP.duration) / STARTUP.springMs, 0, 1);
        const scale = springProgress <= .5
          ? 1 - .04 * (springProgress / .5)
          : .96 + .04 * ((springProgress - .5) / .5);
        scaleX = scale;
        scaleY = scale;
      }
      shape.style.transform = `translate(-50%,-50%) scale(${scaleX}, ${scaleY})`;
      mask.style.transform = `translate(-50%,-50%) scale(${scaleX}, ${scaleY})`;

      if (time <= STARTUP.duration) {
        const lowTime = STARTUP.duration * STARTUP.lowFraction;
        const startY = -((STARTUP.startPercent / 100) * HEIGHT + HEIGHT / 2);
        const y = time <= lowTime
          ? startY + (STARTUP.lowPx - startY) * clamp(time / lowTime, 0, 1)
          : STARTUP.lowPx * (1 - clamp((time - lowTime) / Math.max(1, STARTUP.duration - lowTime), 0, 1));
        motion.style.transform = `translateY(${y}px)`;
      } else {
        motion.style.transform = 'translateY(0px)';
      }
      strip.style.opacity = time >= STARTUP.duration * STARTUP.openFraction ? '1' : '0';

      const visibleWidth = Math.max(64, Number.parseFloat(getComputedStyle(mask).width) || 64);
      const mapUrl = buildStartupMap(fullWidth, visibleWidth, time);
      if (mapUrl) {
        image.setAttribute('href', mapUrl);
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
        image.setAttribute('width', String(Math.round(fullWidth)));
        image.setAttribute('height', String(HEIGHT));
      }
      const padding = STARTUP.zoom.padding;
      filter.setAttribute('x', `${-padding}%`);
      filter.setAttribute('y', `${-padding}%`);
      filter.setAttribute('width', `${100 + padding * 2}%`);
      filter.setAttribute('height', `${100 + padding * 2}%`);
    };

    render(0);
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = Math.min(total, now - start);
      render(elapsed);
      if (elapsed < total) raf = requestAnimationFrame(tick);
      else setPhase('visible');
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      animations.forEach((animation) => animation.cancel());
    };
  }, [hidden, phase, tabs.length]);

  useLayoutEffect(() => {
    if (phase !== 'visible' || hidden || tabs.length === 0) return undefined;
    const root = rootRef.current;
    const pane = paneRef.current;
    const strip = stripRef.current;
    const selectorTrack = selectorTrackRef.current;
    const selector = selectorRef.current;
    const lensTrack = lensTrackRef.current;
    const lens = lensRef.current;
    const opticalImage = opticalImageRef.current;
    const opticalFilter = opticalFilterRef.current;
    const opticalR = opticalRRef.current;
    const opticalG = opticalGRef.current;
    const opticalB = opticalBRef.current;
    if (!root || !pane || !strip || !selectorTrack || !selector || !lensTrack || !lens || !opticalImage || !opticalFilter || !opticalR || !opticalG || !opticalB) return undefined;

    const links = Array.from(strip.querySelectorAll<HTMLButtonElement>(':scope > .ui-liquid-glass-icon-only__tab'));
    if (!links.length) return undefined;

    activeIndexRef.current = Math.max(0, links.findIndex((link) => link.dataset.value === activeValueRef.current));
    let newActiveIndex = activeIndexRef.current;
    let gesture: Gesture = 'idle';
    let touched = false;
    let holdActivated = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;
    let lastPointerX = 0;
    let pressIntentTimer: number | null = null;
    let lensTimer: number | null = null;
    let lensReleasePending = false;
    let lensFullyExpanded = false;
    let moveRaf = 0;
    let setTransform: string | null = null;
    let glassShowTimer: number | null = null;
    let glassWrap: HTMLSpanElement | null = null;
    let glassLight: HTMLSpanElement | null = null;
    let glassScaleActive = false;
    let paneResetTimer: number | null = null;
    let paneResetTransitionCleanup: (() => void) | null = null;
    let mappingRaf = 0;
    let opticalFirstRaf = 0;
    let opticalSecondRaf = 0;
    let pointerId: number | null = null;
    let pointerDownAt = 0;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let startScrollLeft = 0;
    let springAnimation: Animation | null = null;
    let springStartTimer: number | null = null;
    let springFallbackTimer: number | null = null;
    let springArmRaf = 0;
    let tapTravelScaleActive = false;
    let suppressNativeClickUntil = 0;
    const iconAnimations = new Map<HTMLElement, Animation>();

    const clearTimer = (timer: number | null) => {
      if (timer !== null) window.clearTimeout(timer);
    };

    const slotGeometry = (index: number) => {
      const width = strip.clientWidth / links.length;
      return { left: index * width, width };
    };

    const syncSlotWidths = () => {
      const share = `${100 / links.length}%`;
      links.forEach((link) => {
        link.style.width = share;
        link.style.flexBasis = share;
      });
    };

    const positionSelector = (index: number, animate = true) => {
      const geometry = slotGeometry(index);
      selectorTrack.style.transitionDuration = animate ? `${TRAVEL_MS}ms` : '0ms';
      selectorTrack.style.transitionTimingFunction = '';
      selectorTrack.style.width = `${geometry.width}px`;
      selectorTrack.style.transform = `translateX(${geometry.left}px)`;
    };

    const positionLensTrack = (index: number, animate = true) => {
      const geometry = slotGeometry(index);
      lensTrack.style.transitionDuration = animate ? `${TRAVEL_MS}ms` : '0ms';
      lensTrack.style.transitionTimingFunction = '';
      lensTrack.style.width = `${geometry.width}px`;
      lensTrack.style.transform = `translateX(${geometry.left - strip.scrollLeft}px)`;
    };

    const syncLensScale = () => {
      const paneScale = Number.parseFloat(pane.style.scale) || 1;
      lens.style.setProperty('--lgio-pressed-scale', String(LENS_SCALE * paneScale));
    };

    const playActiveIconSpring = (index: number) => {
      const icon = links[index]?.querySelector<HTMLElement>('.ui-liquid-glass-icon-only__icon-wrap');
      if (!icon || typeof icon.animate !== 'function') return;
      iconAnimations.get(icon)?.cancel();
      const animation = icon.animate(activeIconKeyframes(), { duration: ACTIVE_ICON_SPRING_MS, fill: 'none', easing: 'linear' });
      iconAnimations.set(icon, animation);
      animation.addEventListener('finish', () => {
        if (iconAnimations.get(icon) === animation) iconAnimations.delete(icon);
      }, { once: true });
    };

    const markActive = (index: number, emit: boolean) => {
      if (!links[index]) return;
      const previous = activeIndexRef.current;
      activeIndexRef.current = index;
      newActiveIndex = index;
      links.forEach((link, linkIndex) => {
        const active = linkIndex === index;
        link.classList.toggle('is-active', active);
        link.setAttribute('aria-selected', active ? 'true' : 'false');
        link.tabIndex = active ? 0 : -1;
      });
      if (previous !== index) playActiveIconSpring(index);
      if (emit && previous !== index) {
        const nextValue = tabsRef.current[index]?.value;
        if (nextValue !== undefined) {
          internalSelectionRef.current = nextValue;
          onValueChangeRef.current(nextValue);
        }
      }
    };

    const nearestTabIndex = (clientX: number) => {
      const rect = strip.getBoundingClientRect();
      const contentX = clientX - rect.left + strip.scrollLeft;
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      links.forEach((link, index) => {
        const center = link.offsetLeft + link.offsetWidth / 2;
        const distance = Math.abs(center - contentX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    };

    const startAnimation = () => {
      cancelAnimationFrame(moveRaf);
      moveRaf = requestAnimationFrame(() => {
        if (!setTransform) return;
        lensTrack.style.transform = setTransform;
        lensTrack.style.transitionTimingFunction = 'ease-out';
        setTransform = null;
      });
    };

    const beginLensExpansion = () => {
      clearTimer(lensTimer);
      lensReleasePending = false;
      lensFullyExpanded = false;
      selector.classList.add('pressed');
      lens.classList.add('pressed');
      lensTimer = window.setTimeout(() => {
        lensFullyExpanded = true;
        if (lensReleasePending) {
          lensReleasePending = false;
          lensFullyExpanded = false;
          selector.classList.remove('pressed');
          lens.classList.remove('pressed');
          lensTimer = null;
        }
      }, LENS_EXPAND_MS);
    };

    const requestLensRelease = () => {
      if (lensFullyExpanded) {
        clearTimer(lensTimer);
        lensTimer = null;
        lensFullyExpanded = false;
        lensReleasePending = false;
        selector.classList.remove('pressed');
        lens.classList.remove('pressed');
      } else {
        lensReleasePending = true;
      }
    };

    const cancelLensForScroll = () => {
      clearTimer(lensTimer);
      lensTimer = null;
      lensReleasePending = false;
      lensFullyExpanded = false;
      selector.classList.remove('pressed');
      lens.classList.remove('pressed');
    };

    const setHighlightOnTouch = (clientX: number, startLens = true, holdStart = false) => {
      const rect = strip.getBoundingClientRect();
      const contentX = clientX - rect.left + strip.scrollLeft;
      const centers = links.map((link) => link.offsetLeft + link.offsetWidth / 2);
      let closest = 0;
      let distance = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const nextDistance = Math.abs(center - contentX);
        if (nextDistance < distance) {
          closest = index;
          distance = nextDistance;
        }
      });
      newActiveIndex = closest;
      const geometry = slotGeometry(newActiveIndex);
      const maxLeft = Math.max(0, strip.scrollWidth - geometry.width);
      const translateX = clamp(contentX - geometry.width / 2, 0, maxLeft);
      lensTrack.style.width = `${geometry.width}px`;

      if (holdStart) {
        lensTrack.style.transitionDuration = '0ms';
        lensTrack.style.transitionTimingFunction = '';
        lensTrack.style.transform = `translateX(${geometry.left - strip.scrollLeft}px)`;
        selectorTrack.style.transitionDuration = '0ms';
        selectorTrack.style.transitionTimingFunction = '';
        selectorTrack.style.width = `${geometry.width}px`;
        selectorTrack.style.transform = `translateX(${geometry.left}px)`;
        void lensTrack.offsetWidth;
        if (startLens && !lens.classList.contains('pressed')) beginLensExpansion();
        requestAnimationFrame(() => {
          if (lensTrack.isConnected) lensTrack.style.transitionDuration = `${TRAVEL_MS}ms`;
        });
        return;
      }

      if (startLens && !lens.classList.contains('pressed')) beginLensExpansion();
      if (holdActivated) {
        selectorTrack.style.transitionDuration = '0ms';
        selectorTrack.style.transitionTimingFunction = '';
        selectorTrack.style.width = `${geometry.width}px`;
        selectorTrack.style.transform = `translateX(${translateX}px)`;
      }
      setTransform = `translateX(${translateX - strip.scrollLeft}px)`;
      startAnimation();
    };

    const finishHighlight = () => {
      cancelAnimationFrame(moveRaf);
      setTransform = null;
      const next = newActiveIndex;
      if (holdActivated) {
        positionSelector(next, false);
        selectorTrack.style.transitionTimingFunction = '';
      }
      requestLensRelease();
      if (activeIndexRef.current !== next) {
        markActive(next, true);
        suppressNativeClickUntil = performance.now() + 450;
      }
      positionSelector(next);
      positionLensTrack(next);
      lensTrack.style.transitionTimingFunction = '';
    };

    const cancelPressIntent = () => {
      clearTimer(pressIntentTimer);
      pressIntentTimer = null;
    };

    const classifyAsScroll = () => {
      cancelPressIntent();
      gesture = 'scroll';
      cancelLensForScroll();
      setTransform = null;
      cancelAnimationFrame(moveRaf);
      positionLensTrack(activeIndexRef.current, false);
    };

    const moveManualScroll = (clientX: number) => {
      const dx = clientX - touchStartX;
      const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
      strip.scrollLeft = clamp(touchStartScrollLeft - dx, 0, maxScroll);
    };

    const setGlassLightPosition = (clientX: number, clientY: number) => {
      if (!glassLight) return;
      const rect = pane.getBoundingClientRect();
      glassLight.style.transform = `translate3d(${clientX - rect.x}px, ${clientY - rect.y}px, 0)`;
    };

    const cleanupPaneTransition = () => {
      paneResetTransitionCleanup?.();
      paneResetTransitionCleanup = null;
      clearTimer(paneResetTimer);
      paneResetTimer = null;
    };

    const removeGlassHighlight = () => {
      clearTimer(glassShowTimer);
      glassShowTimer = null;
      if (glassScaleActive) {
        glassScaleActive = false;
        pane.style.scale = '';
        cleanupPaneTransition();
        const cleanup = () => {
          pane.style.transitionDuration = '';
          pane.style.transitionTimingFunction = '';
          pane.removeEventListener('transitionend', cleanup);
          paneResetTransitionCleanup = null;
          clearTimer(paneResetTimer);
          paneResetTimer = null;
          syncLensScale();
        };
        pane.style.transitionDuration = `${TRAVEL_MS}ms`;
        pane.style.transitionTimingFunction = 'ease-in-out';
        pane.addEventListener('transitionend', cleanup, { once: true });
        paneResetTimer = window.setTimeout(cleanup, 340);
      }
      if (glassWrap) {
        const wrap = glassWrap;
        if (wrap.style.opacity === '0') wrap.remove();
        else {
          wrap.addEventListener('transitionend', () => wrap.remove(), { once: true });
          wrap.style.opacity = '0';
        }
      }
      glassWrap = null;
      glassLight = null;
    };

    const showGlassHighlight = (clientX: number, clientY: number) => {
      if (glassWrap) return;
      const rect = pane.getBoundingClientRect();
      const radius = Math.sqrt(rect.width ** 2 + rect.height ** 2);
      const wrap = document.createElement('span');
      const light = document.createElement('span');
      wrap.className = 'ui-liquid-glass-icon-only__glass-light-wrap';
      light.className = 'ui-liquid-glass-icon-only__glass-light';
      light.style.width = `${radius * 2}px`;
      light.style.height = `${radius * 2}px`;
      light.style.left = `${-radius}px`;
      light.style.top = `${-radius}px`;
      wrap.appendChild(light);
      pane.appendChild(wrap);
      glassWrap = wrap;
      glassLight = light;
      setGlassLightPosition(clientX, clientY);
      glassScaleActive = true;
      pane.style.scale = String(PANE_SCALE);
      pane.style.transitionDuration = `${TRAVEL_MS}ms`;
      pane.style.transitionTimingFunction = 'ease-in-out';
      syncLensScale();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (wrap.isConnected) wrap.style.opacity = '1';
      }));
    };

    const holdLensForSpring = () => {
      lens.classList.add('tap-spring-active');
      selector.classList.add('tap-spring-hidden');
    };

    const restoreContainerWithSelector = () => {
      if (!tapTravelScaleActive) return;
      tapTravelScaleActive = false;
      cleanupPaneTransition();
      selector.classList.remove('tap-spring-hidden');
      pane.style.transitionDuration = `${TRAVEL_MS}ms`;
      pane.style.transitionTimingFunction = 'ease-in-out';
      pane.style.scale = '';
      syncLensScale();
      const cleanup = () => {
        pane.style.transitionDuration = '';
        pane.style.transitionTimingFunction = '';
        pane.removeEventListener('transitionend', cleanup);
        clearTimer(paneResetTimer);
        paneResetTimer = null;
        paneResetTransitionCleanup = null;
        syncLensScale();
      };
      pane.addEventListener('transitionend', cleanup, { once: true });
      paneResetTimer = window.setTimeout(cleanup, 340);
      paneResetTransitionCleanup = cleanup;
    };

    const releaseLensAfterSpring = () => {
      lens.classList.remove('tap-spring-active');
      selector.classList.remove('tap-spring-hidden');
      restoreContainerWithSelector();
    };

    const cancelSpring = (release = true) => {
      clearTimer(springStartTimer);
      springStartTimer = null;
      clearTimer(springFallbackTimer);
      springFallbackTimer = null;
      cancelAnimationFrame(springArmRaf);
      springAnimation?.cancel();
      springAnimation = null;
      if (release) releaseLensAfterSpring();
    };

    const playTapSpring = () => {
      cancelSpring(false);
      holdLensForSpring();
      if (typeof lens.animate !== 'function') {
        window.setTimeout(releaseLensAfterSpring, SPRING.duration);
        return;
      }
      const animation = lens.animate(springKeyframes(), { duration: SPRING.duration, fill: 'none', easing: 'linear' });
      springAnimation = animation;
      animation.addEventListener('finish', () => {
        if (springAnimation !== animation) return;
        springAnimation = null;
        releaseLensAfterSpring();
      }, { once: true });
      animation.addEventListener('cancel', () => {
        if (springAnimation === animation) springAnimation = null;
      }, { once: true });
    };

    const armSpringBeforeArrival = () => {
      cancelSpring(false);
      tapTravelScaleActive = true;
      pane.style.transitionDuration = `${TRAVEL_MS}ms`;
      pane.style.transitionTimingFunction = 'ease-in-out';
      pane.style.scale = String(PANE_SCALE);
      syncLensScale();
      holdLensForSpring();
      springArmRaf = requestAnimationFrame(() => {
        springStartTimer = window.setTimeout(playTapSpring, Math.max(0, TRAVEL_MS - SPRING.lead));
        springFallbackTimer = window.setTimeout(playTapSpring, TRAVEL_MS + 40);
      });
    };

    const onPanePointerDownCapture = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      cancelSpring();
      restoreContainerWithSelector();
      pointerId = event.pointerId;
      pointerDownAt = performance.now();
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      startScrollLeft = strip.scrollLeft;
    };

    const onDocumentPointerUpCapture = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.pointerId !== pointerId) return;
      const elapsed = performance.now() - pointerDownAt;
      const dx = Math.abs(event.clientX - pointerStartX);
      const dy = Math.abs(event.clientY - pointerStartY);
      const scrollDistance = Math.abs(strip.scrollLeft - startScrollLeft);
      pointerId = null;
      const quick = elapsed < HOLD_DELAY_MS && dx <= 6 && dy <= 10 && scrollDistance <= 4;
      if (!quick) return;
      const targetIndex = nearestTabIndex(event.clientX);
      if (targetIndex !== activeIndexRef.current) armSpringBeforeArrival();
    };

    const onDocumentPointerCancelCapture = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      cancelSpring();
      restoreContainerWithSelector();
    };

    const onPanePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touched = true;
      gesture = 'pending';
      holdActivated = false;
      touchStartX = event.clientX;
      touchStartY = event.clientY;
      touchStartScrollLeft = strip.scrollLeft;
      lastPointerX = event.clientX;
      cancelPressIntent();
      pressIntentTimer = window.setTimeout(() => {
        if (!touched || gesture !== 'pending') return;
        holdActivated = true;
        gesture = 'press';
        setHighlightOnTouch(lastPointerX, true, true);
        showGlassHighlight(lastPointerX, event.clientY);
      }, HOLD_DELAY_MS);
    };

    const onDocumentPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touched) return;
      lastPointerX = event.clientX;
      const dx = event.clientX - touchStartX;
      const dy = event.clientY - touchStartY;
      if (gesture === 'pending') {
        if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) {
          classifyAsScroll();
          moveManualScroll(event.clientX);
        }
        return;
      }
      if (gesture === 'scroll') {
        event.preventDefault();
        moveManualScroll(event.clientX);
        return;
      }
      if (gesture === 'press') {
        event.preventDefault();
        setHighlightOnTouch(event.clientX, false, false);
        setGlassLightPosition(event.clientX, event.clientY);
      }
    };

    const finishPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touched) return;
      const wasScroll = gesture === 'scroll';
      const wasPress = gesture === 'press';
      touched = false;
      cancelPressIntent();
      const scrollDistance = Math.abs(strip.scrollLeft - touchStartScrollLeft);
      const wasRealScroll = wasScroll && scrollDistance > 4;
      if (wasRealScroll) {
        holdActivated = false;
        gesture = 'idle';
        positionLensTrack(activeIndexRef.current, false);
        cancelAnimationFrame(moveRaf);
        removeGlassHighlight();
        return;
      }
      if (wasScroll) strip.scrollLeft = touchStartScrollLeft;
      if (!wasPress) {
        gesture = 'press';
        setHighlightOnTouch(event.clientX, true, false);