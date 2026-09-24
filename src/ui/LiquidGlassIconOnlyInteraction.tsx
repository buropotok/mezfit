import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useLiquidGlassFilterId } from './liquidGlass';

export const LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET = {
  holdDelayMs: 140,
  lensExpandMs: 300,
  lensTravelMs: 300,
  containerScale: 1.05,
  lensScale: 1.25,
  spring: {
    durationMs: 600,
    leadMs: 90,
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
  },
  optics: {
    neutralEdge: 1.7,
    rimWidth: 8,
    rimStrength: .67,
    trenchWidth: 1,
    trenchStrength: .09,
    refraction: 8,
    rgbSpread: .1,
    padding: 51,
  },
} as const;

type IconOnlyInteractionArgs = {
  enabled: boolean;
  activeValue?: string;
  listRef: RefObject<HTMLDivElement | null>;
  indicatorRef: RefObject<HTMLDivElement | null>;
  indicatorSurfaceRef: RefObject<HTMLDivElement | null>;
};

type GestureState = 'idle' | 'pending' | 'press' | 'cancelled';

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function bendHandleTime(index: 1 | 2) {
  const spring = LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring;
  if (index === 1) {
    const room = spring.p2Time - spring.p1Time;
    return spring.p1Time + Math.min(46, Math.max(18, room * .34));
  }
  const room = spring.durationMs - spring.p2Time;
  return spring.p2Time + Math.min(46, Math.max(18, room * .42));
}

function tangentAt(axis: 'x' | 'y', index: 1 | 2) {
  const spring = LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring;
  const amplitude = axis === 'x'
    ? index === 1 ? spring.x1 : spring.x2
    : index === 1 ? spring.y1 : spring.y2;
  const bend = axis === 'x'
    ? index === 1 ? spring.xBend1 : spring.xBend2
    : index === 1 ? spring.yBend1 : spring.yBend2;
  const pointTime = index === 1 ? spring.p1Time : spring.p2Time;
  return (bend - amplitude) / Math.max(1, bendHandleTime(index) - pointTime);
}

function hermite(time: number, t0: number, y0: number, m0: number, t1: number, y1: number, m1: number) {
  const duration = Math.max(1, t1 - t0);
  const progress = clamp((time - t0) / duration, 0, 1);
  const p2 = progress * progress;
  const p3 = p2 * progress;
  const h00 = 2 * p3 - 3 * p2 + 1;
  const h10 = p3 - 2 * p2 + progress;
  const h01 = -2 * p3 + 3 * p2;
  const h11 = p3 - p2;
  return h00 * y0 + h10 * duration * m0 + h01 * y1 + h11 * duration * m1;
}

function springCurveValue(axis: 'x' | 'y', time: number) {
  const spring = LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring;
  const first = axis === 'x' ? spring.x1 : spring.y1;
  const second = axis === 'x' ? spring.x2 : spring.y2;
  const firstTangent = tangentAt(axis, 1);
  const secondTangent = tangentAt(axis, 2);

  if (time <= spring.p1Time) {
    return hermite(time, 0, 1, 0, spring.p1Time, first, firstTangent);
  }
  if (time <= spring.p2Time) {
    return hermite(time, spring.p1Time, first, firstTangent, spring.p2Time, second, secondTangent);
  }
  return hermite(time, spring.p2Time, second, secondTangent, spring.durationMs, 1, 0);
}

function sampledSpringKeyframes() {
  const samples = 64;
  const spring = LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const time = spring.durationMs * (index / samples);
    return {
      transform: `scale(${springCurveValue('x', time).toFixed(4)}, ${springCurveValue('y', time).toFixed(4)})`,
      offset: index / samples,
    };
  });
}

function roundedRectSdf(x: number, y: number, halfWidth: number, halfHeight: number, radius: number) {
  const qx = Math.abs(x) - (halfWidth - radius);
  const qy = Math.abs(y) - (halfHeight - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

export function useLiquidGlassIconOnlyInteraction({
  enabled,
  activeValue,
  listRef,
  indicatorRef,
  indicatorSurfaceRef,
}: IconOnlyInteractionArgs) {
  const lensTrackRef = useRef<HTMLSpanElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const vectorImageRef = useRef<SVGFEImageElement>(null);
  const displacementRRef = useRef<SVGFEDisplacementMapElement>(null);
  const displacementGRef = useRef<SVGFEDisplacementMapElement>(null);
  const displacementBRef = useRef<SVGFEDisplacementMapElement>(null);
  const filterId = useLiquidGlassFilterId('icon-only-lens');

  const activeValueRef = useRef(activeValue);
  const activeIndexRef = useRef(0);
  const internalActivationIndexRef = useRef<number | null>(null);
  const gestureRef = useRef<GestureState>('idle');
  const pointerIdRef = useRef<number | null>(null);
  const pointerDownAtRef = useRef(0);
  const pointerStartXRef = useRef(0);
  const pointerStartYRef = useRef(0);
  const lastPointerXRef = useRef(0);
  const pressIntentTimerRef = useRef<number | null>(null);
  const lensTimerRef = useRef<number | null>(null);
  const lensReleasePendingRef = useRef(false);
  const lensFullyExpandedRef = useRef(false);
  const lensMoveRafRef = useRef<number | null>(null);
  const mappingRafRef = useRef<number | null>(null);
  const springStartTimerRef = useRef<number | null>(null);
  const springFallbackTimerRef = useRef<number | null>(null);
  const springAnimationRef = useRef<Animation | null>(null);
  const paneResetTimerRef = useRef<number | null>(null);
  const highlightRemovalTimerRef = useRef<number | null>(null);
  const highlightFirstRafRef = useRef<number | null>(null);
  const highlightSecondRafRef = useRef<number | null>(null);
  const suppressNativeClickUntilRef = useRef(0);
  const highlightWrapRef = useRef<HTMLSpanElement | null>(null);
  const highlightLightRef = useRef<HTMLSpanElement | null>(null);
  const iconAnimationsRef = useRef(new Map<HTMLElement, Animation>());

  useEffect(() => {
    activeValueRef.current = activeValue;
  }, [activeValue]);

  const clearTimer = (ref: RefObject<number | null>) => {
    if (ref.current !== null) window.clearTimeout(ref.current);
    ref.current = null;
  };

  const getTriggers = () => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > .ui-tabs__trigger'));
  };

  const indexForActiveValue = () => {
    const triggers = getTriggers();
    const byValue = triggers.findIndex((trigger) => trigger.dataset.uiTabValue === activeValueRef.current);
    if (byValue >= 0) return byValue;
    const byState = triggers.findIndex((trigger) => trigger.dataset.state === 'active');
    return Math.max(0, byState);
  };

  const visualTrackGeometry = (index: number) => {
    const list = listRef.current;
    const triggers = getTriggers();
    if (!list || !triggers.length) return { left: 0, width: 0 };
    const width = list.clientWidth / triggers.length;
    return { left: index * width, width };
  };

  const positionSelector = (index: number, animate = true) => {
    const track = indicatorRef.current;
    if (!track) return;
    const geometry = visualTrackGeometry(index);
    track.style.transitionDuration = animate ? `${LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs}ms` : '0ms';
    track.style.transitionTimingFunction = '';
    track.style.width = `${geometry.width}px`;
    track.style.transform = `translateX(${geometry.left}px)`;
  };

  const positionLensTrack = (index: number, animate = true) => {
    const list = listRef.current;
    const track = lensTrackRef.current;
    if (!list || !track) return;
    const geometry = visualTrackGeometry(index);
    track.style.transitionDuration = animate ? `${LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs}ms` : '0ms';
    track.style.transitionTimingFunction = '';
    track.style.width = `${geometry.width}px`;
    track.style.transform = `translateX(${geometry.left - list.scrollLeft}px)`;
  };

  const nearestTabIndex = (clientX: number) => {
    const list = listRef.current;
    const triggers = getTriggers();
    if (!list || !triggers.length) return 0;
    const rect = list.getBoundingClientRect();
    const contentX = clientX - rect.left + list.scrollLeft;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    triggers.forEach((trigger, index) => {
      const center = trigger.offsetLeft + trigger.offsetWidth / 2;
      const distance = Math.abs(center - contentX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  };

  const setLensPointerPosition = (clientX: number, holdStart = false) => {
    const list = listRef.current;
    const track = lensTrackRef.current;
    const selectorTrack = indicatorRef.current;
    if (!list || !track || !selectorTrack) return 0;

    const triggers = getTriggers();
    if (!triggers.length) return 0;
    const rect = list.getBoundingClientRect();
    const contentX = clientX - rect.left + list.scrollLeft;
    const targetIndex = nearestTabIndex(clientX);
    const targetGeometry = visualTrackGeometry(targetIndex);
    const rawLeft = contentX - targetGeometry.width / 2;
    const maxLeft = Math.max(0, list.scrollWidth - targetGeometry.width);
    const left = clamp(rawLeft, 0, maxLeft);
    const visualLeft = left - list.scrollLeft;

    track.style.width = `${targetGeometry.width}px`;

    if (holdStart) {
      track.style.transitionDuration = '0ms';
      track.style.transform = `translateX(${targetGeometry.left - list.scrollLeft}px)`;
      selectorTrack.style.transitionDuration = '0ms';
      selectorTrack.style.width = `${targetGeometry.width}px`;
      selectorTrack.style.transform = `translateX(${targetGeometry.left}px)`;
      void track.offsetWidth;
      requestAnimationFrame(() => {
        if (track.isConnected) track.style.transitionDuration = `${LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs}ms`;
      });
      return targetIndex;
    }

    if (gestureRef.current === 'press') {
      selectorTrack.style.transitionDuration = '0ms';
      selectorTrack.style.width = `${targetGeometry.width}px`;
      selectorTrack.style.transform = `translateX(${left}px)`;
    }

    if (lensMoveRafRef.current !== null) cancelAnimationFrame(lensMoveRafRef.current);
    lensMoveRafRef.current = requestAnimationFrame(() => {
      track.style.transform = `translateX(${visualLeft}px)`;
      track.style.transitionTimingFunction = 'ease-out';
      lensMoveRafRef.current = null;
    });
    return targetIndex;
  };

  const syncLensScaleWithContainer = () => {
    const list = listRef.current;
    const lens = lensRef.current;
    if (!list || !lens) return;
    const containerScale = Number.parseFloat(list.style.scale) || 1;
    lens.style.setProperty(
      '--ui-icon-only-pressed-scale',
      String(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensScale * containerScale),
    );
  };

  const beginLensExpansion = () => {
    const selector = indicatorSurfaceRef.current;
    const lens = lensRef.current;
    if (!selector || !lens) return;

    clearTimer(lensTimerRef);
    lensReleasePendingRef.current = false;
    lensFullyExpandedRef.current = false;
    selector.classList.add('pressed');
    lens.classList.add('pressed');

    lensTimerRef.current = window.setTimeout(() => {
      lensFullyExpandedRef.current = true;
      if (lensReleasePendingRef.current) {
        selector.classList.remove('pressed');
        lens.classList.remove('pressed');
        lensFullyExpandedRef.current = false;
        lensReleasePendingRef.current = false;
        lensTimerRef.current = null;
      }
    }, LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensExpandMs);
  };

  const requestLensRelease = () => {
    const selector = indicatorSurfaceRef.current;
    const lens = lensRef.current;
    if (!selector || !lens) return;

    if (lensFullyExpandedRef.current) {
      clearTimer(lensTimerRef);
      lensFullyExpandedRef.current = false;
      lensReleasePendingRef.current = false;
      selector.classList.remove('pressed');
      lens.classList.remove('pressed');
      return;
    }
    lensReleasePendingRef.current = true;
  };

  const cancelLens = () => {
    clearTimer(lensTimerRef);
    lensFullyExpandedRef.current = false;
    lensReleasePendingRef.current = false;
    indicatorSurfaceRef.current?.classList.remove('pressed', 'tap-spring-hidden');
    lensRef.current?.classList.remove('pressed', 'tap-spring-active');
  };

  const setHighlightPosition = (clientX: number, clientY: number) => {
    const list = listRef.current;
    const light = highlightLightRef.current;
    if (!list || !light) return;
    const rect = list.getBoundingClientRect();
    light.style.transform = `translate3d(${clientX - rect.x}px, ${clientY - rect.y}px, 0)`;
  };

  const removeGlassHighlight = () => {
    const list = listRef.current;
    const wrap = highlightWrapRef.current;
    if (list) {
      list.style.scale = '';
      list.style.transitionDuration = '300ms';
      list.style.transitionTimingFunction = 'ease-in-out';
      if (paneResetTimerRef.current !== null) window.clearTimeout(paneResetTimerRef.current);
      paneResetTimerRef.current = window.setTimeout(() => {
        list.style.transitionDuration = '';
        list.style.transitionTimingFunction = '';
        paneResetTimerRef.current = null;
      }, 340);
    }
    if (wrap) {
      wrap.style.opacity = '0';
      clearTimer(highlightRemovalTimerRef);
      highlightRemovalTimerRef.current = window.setTimeout(() => {
        wrap.remove();
        highlightRemovalTimerRef.current = null;
      }, 320);
    }
    highlightWrapRef.current = null;
    highlightLightRef.current = null;
  };

  const showGlassHighlight = (clientX: number, clientY: number) => {
    const list = listRef.current;
    if (!list || highlightWrapRef.current) return;
    const rect = list.getBoundingClientRect();
    const radius = Math.sqrt(rect.width ** 2 + rect.height ** 2);
    const wrap = document.createElement('span');
    const light = document.createElement('span');
    wrap.className = 'ui-tabs__icon-only-glass-light-wrap';
    light.className = 'ui-tabs__icon-only-glass-light';
    light.style.width = `${radius * 2}px`;
    light.style.height = `${radius * 2}px`;
    light.style.left = `${-radius}px`;
    light.style.top = `${-radius}px`;
    wrap.appendChild(light);
    list.appendChild(wrap);
    highlightWrapRef.current = wrap;
    highlightLightRef.current = light;
    setHighlightPosition(clientX, clientY);

    list.style.scale = String(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.containerScale);
    list.style.transitionDuration = '300ms';
    list.style.transitionTimingFunction = 'ease-in-out';
    syncLensScaleWithContainer();

    if (highlightFirstRafRef.current !== null) cancelAnimationFrame(highlightFirstRafRef.current);
    if (highlightSecondRafRef.current !== null) cancelAnimationFrame(highlightSecondRafRef.current);
    highlightFirstRafRef.current = requestAnimationFrame(() => {
      highlightFirstRafRef.current = null;
      highlightSecondRafRef.current = requestAnimationFrame(() => {
        highlightSecondRafRef.current = null;
        if (wrap.isConnected) wrap.style.opacity = '1';
      });
    });
  };

  const expandContainerForTapTravel = () => {
    const list = listRef.current;
    if (!list) return;
    list.style.transitionDuration = '300ms';
    list.style.transitionTimingFunction = 'ease-in-out';
    list.style.scale = String(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.containerScale);
    syncLensScaleWithContainer();
  };

  const restoreContainerWithSelector = () => {
    const list = listRef.current;
    const selector = indicatorSurfaceRef.current;
    if (!list || !selector) return;
    selector.classList.remove('tap-spring-hidden');
    list.style.transitionDuration = '300ms';
    list.style.transitionTimingFunction = 'ease-in-out';
    list.style.scale = '';
    syncLensScaleWithContainer();
    if (paneResetTimerRef.current !== null) window.clearTimeout(paneResetTimerRef.current);
    paneResetTimerRef.current = window.setTimeout(() => {
      list.style.transitionDuration = '';
      list.style.transitionTimingFunction = '';
      paneResetTimerRef.current = null;
    }, 340);
  };

  const holdLensForSpring = () => {
    lensRef.current?.classList.add('tap-spring-active');
    indicatorSurfaceRef.current?.classList.add('tap-spring-hidden');
  };

  const releaseLensAfterSpring = () => {
    lensRef.current?.classList.remove('tap-spring-active');
    restoreContainerWithSelector();
  };

  const cancelSpring = (release = true) => {
    clearTimer(springStartTimerRef);
    clearTimer(springFallbackTimerRef);
    springAnimationRef.current?.cancel();
    springAnimationRef.current = null;
    if (release) releaseLensAfterSpring();
  };

  const playTapSpring = () => {
    const lens = lensRef.current;
    if (!lens) return;
    cancelSpring(false);
    holdLensForSpring();
    const animation = lens.animate(sampledSpringKeyframes(), {
      duration: LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.durationMs,
      fill: 'none',
      easing: 'linear',
    });
    springAnimationRef.current = animation;
    animation.addEventListener('finish', () => {
      if (springAnimationRef.current !== animation) return;
      springAnimationRef.current = null;
      releaseLensAfterSpring();
    }, { once: true });
    animation.addEventListener('cancel', () => {
      if (springAnimationRef.current === animation) springAnimationRef.current = null;
    }, { once: true });
  };

  const armSpringBeforeArrival = () => {
    cancelSpring(false);
    expandContainerForTapTravel();
    holdLensForSpring();
    const run = () => {
      clearTimer(springStartTimerRef);
      clearTimer(springFallbackTimerRef);
      playTapSpring();
    };
    springStartTimerRef.current = window.setTimeout(
      run,
      Math.max(
        0,
        LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs
          - LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.leadMs,
      ),
    );
    springFallbackTimerRef.current = window.setTimeout(
      run,
      LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs + 40,
    );
  };

  const playActiveIconSpring = (index: number) => {
    const trigger = getTriggers()[index];
    const icon = trigger?.querySelector<HTMLElement>('.ui-tabs__icon');
    if (!icon) return;
    iconAnimationsRef.current.get(icon)?.cancel();
    const totalMs = Math.max(
      360,
      LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs
        - LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.leadMs
        + LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.durationMs
        + 300,
    );
    const animation = icon.animate(
      [
        { transform: 'scale(1)', offset: 0, easing: 'cubic-bezier(.18,.75,.22,1)' },
        { transform: 'scale(1.16)', offset: .16, easing: 'cubic-bezier(.16,.9,.22,1)' },
        { transform: 'scale(.94)', offset: .34, easing: 'cubic-bezier(.20,.82,.26,1)' },
        { transform: 'scale(1.055)', offset: .53, easing: 'cubic-bezier(.18,.82,.24,1)' },
        { transform: 'scale(.985)', offset: .72, easing: 'cubic-bezier(.2,.78,.25,1)' },
        { transform: 'scale(1.012)', offset: .86, easing: 'ease-out' },
        { transform: 'scale(1)', offset: 1 },
      ],
      { duration: totalMs, fill: 'none', easing: 'linear' },
    );
    iconAnimationsRef.current.set(icon, animation);
    animation.addEventListener('finish', () => {
      if (iconAnimationsRef.current.get(icon) === animation) iconAnimationsRef.current.delete(icon);
    }, { once: true });
  };

  const activateIndex = (index: number) => {
    const triggers = getTriggers();
    const trigger = triggers[index];
    if (!trigger) return;
    const previous = activeIndexRef.current;
    activeIndexRef.current = index;
    if (previous !== index) {
      internalActivationIndexRef.current = index;
      trigger.click();
      suppressNativeClickUntilRef.current = performance.now() + 450;
      playActiveIconSpring(index);
    }
  };

  const quickTap = (clientX: number, springTravel: boolean) => {
    const targetIndex = nearestTabIndex(clientX);
    const currentIndex = activeIndexRef.current;

    setLensPointerPosition(clientX);
    beginLensExpansion();

    if (targetIndex !== currentIndex) {
      if (springTravel) armSpringBeforeArrival();
      activateIndex(targetIndex);
    }

    requestLensRelease();
    positionSelector(targetIndex);
    positionLensTrack(targetIndex);
  };

  const finishLongPress = (clientX: number) => {
    const targetIndex = setLensPointerPosition(clientX);
    positionSelector(targetIndex, false);
    requestLensRelease();
    activateIndex(targetIndex);
    positionLensTrack(targetIndex);
    removeGlassHighlight();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    cancelSpring();
    cancelLens();
    removeGlassHighlight();
    pointerIdRef.current = event.pointerId;
    pointerDownAtRef.current = performance.now();
    pointerStartXRef.current = event.clientX;
    pointerStartYRef.current = event.clientY;
    lastPointerXRef.current = event.clientX;
    gestureRef.current = 'pending';
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort in embedded WebViews.
    }

    clearTimer(pressIntentTimerRef);
    pressIntentTimerRef.current = window.setTimeout(() => {
      if (pointerIdRef.current !== event.pointerId || gestureRef.current !== 'pending') return;
      gestureRef.current = 'press';
      const targetIndex = setLensPointerPosition(lastPointerXRef.current, true);
      activeIndexRef.current = Math.max(0, activeIndexRef.current);
      beginLensExpansion();
      showGlassHighlight(lastPointerXRef.current, event.clientY);
      positionSelector(targetIndex, false);
    }, LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.holdDelayMs);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerId !== pointerIdRef.current) return;
    lastPointerXRef.current = event.clientX;
    const dx = event.clientX - pointerStartXRef.current;
    const dy = event.clientY - pointerStartYRef.current;

    if (gestureRef.current === 'pending') {
      if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) {
        gestureRef.current = 'cancelled';
        clearTimer(pressIntentTimerRef);
      }
      return;
    }

    if (gestureRef.current === 'press') {
      event.preventDefault();
      setLensPointerPosition(event.clientX);
      setHighlightPosition(event.clientX, event.clientY);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerId !== pointerIdRef.current) return;
    clearTimer(pressIntentTimerRef);
    const gesture = gestureRef.current;
    const elapsed = performance.now() - pointerDownAtRef.current;
    const dx = Math.abs(event.clientX - pointerStartXRef.current);
    const dy = Math.abs(event.clientY - pointerStartYRef.current);

    pointerIdRef.current = null;
    gestureRef.current = 'idle';
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the WebView.
    }

    if (gesture === 'press') {
      finishLongPress(event.clientX);
      return;
    }

    if (gesture === 'cancelled') {
      quickTap(
        event.clientX,
        elapsed < LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.holdDelayMs && dx <= 6 && dy <= 10,
      );
      return;
    }

    if (elapsed < LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.holdDelayMs) {
      quickTap(event.clientX, dx <= 6 && dy <= 10);
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    gestureRef.current = 'idle';
    clearTimer(pressIntentTimerRef);
    cancelSpring();
    cancelLens();
    removeGlassHighlight();
    positionSelector(activeIndexRef.current, false);
    positionLensTrack(activeIndexRef.current, false);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (event.nativeEvent.isTrusted && performance.now() < suppressNativeClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  useLayoutEffect(() => {
    if (enabled) return;

    pointerIdRef.current = null;
    gestureRef.current = 'idle';
    clearTimer(pressIntentTimerRef);
    clearTimer(lensTimerRef);
    clearTimer(springStartTimerRef);
    clearTimer(springFallbackTimerRef);
    clearTimer(paneResetTimerRef);
    clearTimer(highlightRemovalTimerRef);
    if (highlightFirstRafRef.current !== null) cancelAnimationFrame(highlightFirstRafRef.current);
    highlightFirstRafRef.current = null;
    if (highlightSecondRafRef.current !== null) cancelAnimationFrame(highlightSecondRafRef.current);
    highlightSecondRafRef.current = null;

    if (lensMoveRafRef.current !== null) cancelAnimationFrame(lensMoveRafRef.current);
    lensMoveRafRef.current = null;
    if (mappingRafRef.current !== null) cancelAnimationFrame(mappingRafRef.current);
    mappingRafRef.current = null;

    springAnimationRef.current?.cancel();
    springAnimationRef.current = null;
    iconAnimationsRef.current.forEach((animation) => animation.cancel());
    iconAnimationsRef.current.clear();

    const list = listRef.current;
    if (list) {
      list.style.scale = '';
      list.style.transitionDuration = '';
      list.style.transitionTimingFunction = '';
    }

    highlightWrapRef.current?.remove();
    highlightWrapRef.current = null;
    highlightLightRef.current = null;
    indicatorSurfaceRef.current?.classList.remove('pressed', 'tap-spring-hidden');
    lensRef.current?.classList.remove('pressed', 'tap-spring-active');
    lensReleasePendingRef.current = false;
    lensFullyExpandedRef.current = false;
    internalActivationIndexRef.current = null;
  }, [enabled, indicatorSurfaceRef, listRef]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    activeIndexRef.current = indexForActiveValue();
    positionSelector(activeIndexRef.current, false);
    positionLensTrack(activeIndexRef.current, false);

    const list = listRef.current;
    if (!list) return undefined;
    const observer = new ResizeObserver(() => {
      positionSelector(activeIndexRef.current, false);
      positionLensTrack(activeIndexRef.current, false);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [enabled, listRef]);

  useEffect(() => {
    if (!enabled) return;
    const nextIndex = indexForActiveValue();
    activeIndexRef.current = nextIndex;

    if (internalActivationIndexRef.current === nextIndex) {
      internalActivationIndexRef.current = null;
      return;
    }

    if (
      gestureRef.current === 'idle'
      && springAnimationRef.current === null
      && springStartTimerRef.current === null
    ) {
      positionSelector(nextIndex, false);
      positionLensTrack(nextIndex, false);
    }
  }, [activeValue, enabled]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const list = listRef.current;
    const lens = lensRef.current;
    const filter = filterRef.current;
    const vectorImage = vectorImageRef.current;
    const displacementR = displacementRRef.current;
    const displacementG = displacementGRef.current;
    const displacementB = displacementBRef.current;
    if (!list || !lens || !filter || !vectorImage || !displacementR || !displacementG || !displacementB) return undefined;

    const optics = LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.optics;
    const work = document.createElement('canvas');
    const context = work.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;

    const buildVectorMap = () => {
      const width = Math.max(1, lens.offsetWidth);
      const height = Math.max(1, lens.offsetHeight);
      const radius = Math.min(width, height) / 2;
      const sampleScale = Math.max(1.5, Math.min(3, window.devicePixelRatio || 1.5));
      const bitmapWidth = Math.max(128, Math.round(width * sampleScale));
      const bitmapHeight = Math.max(72, Math.round(height * sampleScale));
      work.width = bitmapWidth;
      work.height = bitmapHeight;

      const scaleX = bitmapWidth / width;
      const scaleY = bitmapHeight / height;
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const image = context.createImageData(bitmapWidth, bitmapHeight);
      const data = image.data;
      const epsilon = .35;

      for (let yIndex = 0; yIndex < bitmapHeight; yIndex += 1) {
        const y = (yIndex + .5) / scaleY - halfHeight;
        for (let xIndex = 0; xIndex < bitmapWidth; xIndex += 1) {
          const x = (xIndex + .5) / scaleX - halfWidth;
          const sdf = roundedRectSdf(x, y, halfWidth, halfHeight, radius);
          const depth = -sdf;
          let vectorX = 0;
          let vectorY = 0;

          if (depth > optics.neutralEdge) {
            const gradientX =
              roundedRectSdf(x + epsilon, y, halfWidth, halfHeight, radius)
              - roundedRectSdf(x - epsilon, y, halfWidth, halfHeight, radius);
            const gradientY =
              roundedRectSdf(x, y + epsilon, halfWidth, halfHeight, radius)
              - roundedRectSdf(x, y - epsilon, halfWidth, halfHeight, radius);
            const gradientLength = Math.hypot(gradientX, gradientY) || 1;
            const normalX = gradientX / gradientLength;
            const normalY = gradientY / gradientLength;
            const local = depth - optics.neutralEdge;
            let magnitude = 0;

            if (local < optics.rimWidth) {
              magnitude += Math.sin(Math.PI * (local / optics.rimWidth)) * optics.rimStrength;
            }
            if (local >= optics.rimWidth && local < optics.rimWidth + optics.trenchWidth) {
              const progress = (local - optics.rimWidth) / Math.max(.001, optics.trenchWidth);
              magnitude -= Math.sin(Math.PI * progress) * optics.trenchStrength;
            }
            vectorX = normalX * magnitude;
            vectorY = normalY * magnitude;
          }

          const pixel = (yIndex * bitmapWidth + xIndex) * 4;
          data[pixel] = Math.round(clamp(128 + vectorX * 127, 0, 255));
          data[pixel + 1] = Math.round(clamp(128 + vectorY * 127, 0, 255));
          data[pixel + 2] = 128;
          data[pixel + 3] = 255;
        }
      }

      context.putImageData(image, 0, 0);
      const dataUrl = work.toDataURL('image/png');
      vectorImage.setAttribute('href', dataUrl);
      vectorImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
      vectorImage.setAttribute('width', String(width));
      vectorImage.setAttribute('height', String(height));

      displacementR.setAttribute('scale', String(optics.refraction + optics.rgbSpread));
      displacementG.setAttribute('scale', String(optics.refraction));
      displacementB.setAttribute('scale', String(Math.max(0, optics.refraction - optics.rgbSpread)));
      filter.setAttribute('x', `${-optics.padding}%`);
      filter.setAttribute('y', `${-optics.padding}%`);
      filter.setAttribute('width', `${100 + optics.padding * 2}%`);
      filter.setAttribute('height', `${100 + optics.padding * 2}%`);
    };

    const observer = new ResizeObserver(buildVectorMap);
    observer.observe(lens);
    let secondRaf: number | null = null;
    const firstRaf = requestAnimationFrame(() => {
      secondRaf = requestAnimationFrame(buildVectorMap);
    });
    return () => {
      cancelAnimationFrame(firstRaf);
      if (secondRaf !== null) cancelAnimationFrame(secondRaf);
      observer.disconnect();
    };
  }, [enabled, listRef]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const list = listRef.current;
    const track = lensTrackRef.current;
    if (!list || !track) return undefined;

    const updateMapping = () => {
      const transform = getComputedStyle(track).transform;
      let translateX = 0;
      if (transform && transform !== 'none') {
        try {
          translateX = new DOMMatrixReadOnly(transform).m41;
        } catch {
          const match = transform.match(/^matrix\(([^)]+)\)$/);
          if (match) translateX = Number(match[1].split(',')[4]) || 0;
        }
      }
      const rawCenter = translateX + track.offsetWidth / 2;
      const rect = list.getBoundingClientRect();
      const baseWidth = Math.max(1, list.offsetWidth);
      const liveScale = rect.width / baseWidth;
      const center = baseWidth / 2;
      track.style.left = `${(rawCenter - center) * (liveScale - 1)}px`;
      mappingRafRef.current = requestAnimationFrame(updateMapping);
    };

    const observer = new MutationObserver(syncLensScaleWithContainer);
    observer.observe(list, { attributes: true, attributeFilter: ['style'] });
    syncLensScaleWithContainer();
    mappingRafRef.current = requestAnimationFrame(updateMapping);

    return () => {
      observer.disconnect();
      if (mappingRafRef.current !== null) cancelAnimationFrame(mappingRafRef.current);
      mappingRafRef.current = null;
    };
  }, [enabled, listRef]);

  useEffect(() => () => {
    clearTimer(pressIntentTimerRef);
    clearTimer(lensTimerRef);
    clearTimer(springStartTimerRef);
    clearTimer(springFallbackTimerRef);
    clearTimer(paneResetTimerRef);
    clearTimer(highlightRemovalTimerRef);
    if (highlightFirstRafRef.current !== null) cancelAnimationFrame(highlightFirstRafRef.current);
    if (highlightSecondRafRef.current !== null) cancelAnimationFrame(highlightSecondRafRef.current);
    if (lensMoveRafRef.current !== null) cancelAnimationFrame(lensMoveRafRef.current);
    if (mappingRafRef.current !== null) cancelAnimationFrame(mappingRafRef.current);
    springAnimationRef.current?.cancel();
    iconAnimationsRef.current.forEach((animation) => animation.cancel());
    iconAnimationsRef.current.clear();
    highlightWrapRef.current?.remove();
  }, []);

  const lensStyle = {
    '--ui-icon-only-lens-filter': `url(#${filterId})`,
  } as CSSProperties;

  const filter = enabled ? (
    <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
      <filter ref={filterRef} id={filterId} x="-51%" y="-51%" width="202%" height="202%" colorInterpolationFilters="sRGB">
        <feImage ref={vectorImageRef} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="vectorMap" />
        <feDisplacementMap ref={displacementRRef} in="SourceGraphic" in2="vectorMap" scale="8.1" xChannelSelector="R" yChannelSelector="G" result="dispR" />
        <feColorMatrix in="dispR" type="matrix" result="redPass" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap ref={displacementGRef} in="SourceGraphic" in2="vectorMap" scale="8" xChannelSelector="R" yChannelSelector="G" result="dispG" />
        <feColorMatrix in="dispG" type="matrix" result="greenPass" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap ref={displacementBRef} in="SourceGraphic" in2="vectorMap" scale="7.9" xChannelSelector="R" yChannelSelector="G" result="dispB" />
        <feColorMatrix in="dispB" type="matrix" result="bluePass" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        <feBlend in="redPass" in2="greenPass" mode="screen" result="rg" />
        <feBlend in="rg" in2="bluePass" mode="screen" />
      </filter>
    </svg>
  ) : null;

  return {
    lensTrackRef,
    lensRef,
    lensStyle,
    filter,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  };
}
