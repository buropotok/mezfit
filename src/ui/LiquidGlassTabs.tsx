import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  LIQUID_GLASS_TABS_PRESET,
  LiquidGlassOpticalFilter,
  liquidGlassDifferentTabProgress,
  liquidGlassFullLensSize,
  liquidGlassSameTabProgress,
  useLiquidGlassFilterId,
  type LiquidGlassGeometry,
} from './liquidGlass';

type LiquidGlassTabsControllerArgs = {
  enabled: boolean;
  mode: 'default' | 'icon';
  activeValue?: string;
  rootRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  indicatorRef: RefObject<HTMLDivElement | null>;
  indicatorSurfaceRef: RefObject<HTMLDivElement | null>;
};

type LiquidGlassGesture = {
  pointerId: number;
  target: HTMLButtonElement;
  downAt: number;
  x: number;
  y: number;
  swipe: boolean;
  started: boolean;
  same: boolean;
};

type LiquidGlassDifferentPhase = {
  kind: 'different';
  fromTrigger: HTMLButtonElement;
  toTrigger: HTMLButtonElement;
  startTime: number;
  travelMs: number;
  halfMs: number;
  fromCenter: number;
  toCenter: number;
  fromWidth: number;
  toWidth: number;
  startScroll: number;
  endScroll: number;
  pressed: boolean;
  closeStartAt: number | null;
  impactStarted: boolean;
};

type LiquidGlassSamePhase = {
  kind: 'same';
  trigger: HTMLButtonElement;
  startTime: number;
  travelMs: number;
  halfMs: number;
  pressed: boolean;
  progressAtRelease: number;
  closeStartAt: number | null;
  impactStarted: boolean;
};

type LiquidGlassPhase = LiquidGlassDifferentPhase | LiquidGlassSamePhase;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress);

function shouldReduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function useLiquidGlassTabsController({
  enabled,
  mode,
  activeValue,
  rootRef,
  listRef,
  indicatorRef,
  indicatorSurfaceRef,
}: LiquidGlassTabsControllerArgs) {
  const lensRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<LiquidGlassPhase | null>(null);
  const gestureRef = useRef<LiquidGlassGesture | null>(null);
  const rafRef = useRef<number | null>(null);
  const pressIntentTimerRef = useRef<number | null>(null);
  const iconSpringTimerRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);
  const interactionTokenRef = useRef(0);
  const rootAnimationRef = useRef<Animation | null>(null);
  const selectorAnimationRef = useRef<Animation | null>(null);
  const iconAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  const activeValueRef = useRef(activeValue);
  const containerFilterId = useLiquidGlassFilterId('tabs-container');
  const lensFilterId = useLiquidGlassFilterId('tabs-lens');
  const [containerGeometry, setContainerGeometry] = useState<LiquidGlassGeometry>({ width: 1, height: 1, radiusX: 1, radiusY: 1 });
  const [lensGeometry, setLensGeometry] = useState<LiquidGlassGeometry>({ width: 1, height: 1, radiusX: 1, radiusY: 1 });

  useEffect(() => {
    activeValueRef.current = activeValue;
  }, [activeValue]);

  const getTriggers = useCallback(() => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > .ui-tabs__trigger'));
  }, [listRef]);

  const getActiveTrigger = useCallback(() => {
    const value = activeValueRef.current;
    const triggers = getTriggers();
    return triggers.find((trigger) => trigger.dataset.uiTabValue === value)
      ?? triggers.find((trigger) => trigger.dataset.state === 'active')
      ?? null;
  }, [getTriggers]);

  const getModeRadius = useCallback(() => mode === 'icon' ? 30 : 18, [mode]);
  const getModeInset = useCallback(() => 4, []);

  const getBaseHeight = useCallback(() => {
    const list = listRef.current;
    if (!list) return 1;
    return Math.max(1, list.offsetHeight - getModeInset() * 2);
  }, [getModeInset, listRef]);

  const getFullLensSize = useCallback((selectorWidth: number) => {
    const list = listRef.current;
    if (!list) return { width: 1, height: 1 };
    return liquidGlassFullLensSize(list.offsetHeight, selectorWidth, mode);
  }, [listRef, mode]);

  const getTriggerContentCenter = useCallback((trigger: HTMLButtonElement) => trigger.offsetLeft + trigger.offsetWidth / 2, []);

  const getVisibleCenter = useCallback((contentCenter: number) => {
    const list = listRef.current;
    if (!list) return contentCenter;
    return list.offsetLeft + contentCenter - list.scrollLeft;
  }, [listRef]);

  const updateContainerOptics = useCallback(() => {
    if (!enabled) return;
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const computedRadius = Number.parseFloat(getComputedStyle(list).borderTopLeftRadius);
    const radius = Number.isFinite(computedRadius) && computedRadius > 0
      ? computedRadius
      : Math.min(rect.width, rect.height) / 2;
    const next = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      radiusX: radius,
      radiusY: radius,
    };
    setContainerGeometry((current) => (
      Math.abs(current.width - next.width) < .5
      && Math.abs(current.height - next.height) < .5
      && Math.abs(current.radiusX - next.radiusX) < .5
        ? current
        : next
    ));
  }, [enabled, listRef]);

  const prepareLensOptics = useCallback((selectorWidth: number) => {
    if (!enabled) return;
    const size = getFullLensSize(selectorWidth);
    const next = {
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      radiusX: Math.max(1, size.width / 2),
      radiusY: Math.max(1, size.height / 2),
    };
    setLensGeometry((current) => (
      Math.abs(current.width - next.width) < .5
      && Math.abs(current.height - next.height) < .5
        ? current
        : next
    ));
  }, [enabled, getFullLensSize]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const list = listRef.current;
    if (!list) return undefined;
    updateContainerOptics();
    const active = getActiveTrigger();
    if (active) prepareLensOptics(active.offsetWidth);
    const observer = new ResizeObserver(() => {
      updateContainerOptics();
      const currentActive = getActiveTrigger();
      if (currentActive && !phaseRef.current) prepareLensOptics(currentActive.offsetWidth);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [enabled, getActiveTrigger, listRef, prepareLensOptics, updateContainerOptics]);

  const renderLensGeometry = useCallback((centerX: number, baseWidth: number, progress: number) => {
    const lens = lensRef.current;
    const list = listRef.current;
    if (!lens || !list) return;

    const p = clamp(progress, 0, 1);
    const baseHeight = getBaseHeight();
    const fullSize = getFullLensSize(baseWidth);
    const width = lerp(baseWidth, fullSize.width, p);
    const height = lerp(baseHeight, fullSize.height, p);
    const radiusX = lerp(getModeRadius(), width / 2, p);
    const radiusY = lerp(getModeRadius(), height / 2, p);

    lens.style.left = `${centerX - width / 2}px`;
    lens.style.top = `${list.offsetTop + list.offsetHeight / 2 - height / 2}px`;
    lens.style.width = `${width}px`;
    lens.style.height = `${height}px`;
    lens.style.borderRadius = `${radiusX}px / ${radiusY}px`;
  }, [getBaseHeight, getFullLensSize, getModeRadius, listRef]);

  const snapIndicatorTo = useCallback((trigger: HTMLButtonElement | null) => {
    const indicator = indicatorRef.current;
    if (!indicator || !trigger) return;
    indicator.style.transform = `translateX(${trigger.offsetLeft}px)`;
    indicator.style.width = `${trigger.offsetWidth}px`;
  }, [indicatorRef]);

  const targetScrollFor = useCallback((trigger: HTMLButtonElement) => {
    const list = listRef.current;
    if (!list) return 0;
    const triggers = getTriggers();
    const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
    const index = triggers.indexOf(trigger);
    if (index === 0) return 0;
    if (index === triggers.length - 1) return maxScroll;

    const full = getFullLensSize(trigger.offsetWidth);
    const requiredHalf = Math.max(trigger.offsetWidth, full.width) / 2 + LIQUID_GLASS_TABS_PRESET.keepInsideMarginPx;
    const center = getTriggerContentCenter(trigger);
    const visible = center - list.scrollLeft;
    if (visible < requiredHalf) return clamp(center - requiredHalf, 0, maxScroll);
    if (visible > list.clientWidth - requiredHalf) {
      return clamp(center - (list.clientWidth - requiredHalf), 0, maxScroll);
    }
    return list.scrollLeft;
  }, [getFullLensSize, getTriggerContentCenter, getTriggers, listRef]);

  const startRootExpansion = useCallback(() => {
    const root = rootRef.current;
    if (!root || shouldReduceMotion()) return;
    rootAnimationRef.current?.cancel();
    rootAnimationRef.current = root.animate(
      [{ scale: '1' }, { scale: String(LIQUID_GLASS_TABS_PRESET.containerMaxScalePercent / 100) }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
  }, [rootRef]);

  const startContainerSpring = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const currentScale = Number.parseFloat(getComputedStyle(root).scale) || 1;
    rootAnimationRef.current?.cancel();

    if (shouldReduceMotion()) {
      root.style.scale = '1';
      return;
    }

    const preset = LIQUID_GLASS_TABS_PRESET.containerSpring;
    const travel = (LIQUID_GLASS_TABS_PRESET.containerMaxScalePercent - 100) / 100;
    const overshoot = 1 - travel * preset.overshootPercent / 100;
    const recoil = 1 + travel * preset.recoilPercent / 100;

    rootAnimationRef.current = root.animate(
      [
        { scale: String(currentScale), offset: 0 },
        { scale: String(overshoot), offset: .42, easing: 'cubic-bezier(.18,.89,.32,1.16)' },
        { scale: String(recoil), offset: .70, easing: 'ease-out' },
        { scale: '1', offset: 1, easing: 'ease-out' },
      ],
      { duration: preset.durationMs, easing: 'linear', fill: 'forwards' },
    );
    rootAnimationRef.current.onfinish = () => {
      root.style.scale = '1';
      rootAnimationRef.current?.cancel();
      rootAnimationRef.current = null;
    };
  }, [rootRef]);

  const startIconSpring = useCallback((trigger: HTMLButtonElement) => {
    if (mode !== 'icon' || shouldReduceMotion()) return;
    const icon = trigger.querySelector<HTMLElement>('.ui-tabs__icon');
    if (!icon) return;

    iconAnimationsRef.current.get(icon)?.cancel();
    const preset = LIQUID_GLASS_TABS_PRESET.iconSpring;
    const up = 1 + preset.overshootPercent / 100;
    const down = Math.max(.7, 1 - preset.recoilPercent / 100);
    const animation = icon.animate(
      [
        { transform: 'scale(1)', offset: 0 },
        { transform: `scale(${up})`, offset: .24, easing: 'cubic-bezier(.18,.89,.32,1.28)' },
        { transform: `scale(${down})`, offset: .50, easing: 'ease-out' },
        { transform: `scale(${1 + preset.overshootPercent / 100 * .30})`, offset: .72, easing: 'ease-out' },
        { transform: `scale(${1 - preset.recoilPercent / 100 * .18})`, offset: .88, easing: 'ease-out' },
        { transform: 'scale(1)', offset: 1 },
      ],
      { duration: preset.durationMs, easing: 'linear' },
    );
    iconAnimationsRef.current.set(icon, animation);
    animation.onfinish = () => iconAnimationsRef.current.delete(icon);
  }, [mode]);

  const startSelectorSpring = useCallback(() => {
    const surface = indicatorSurfaceRef.current;
    const indicator = indicatorRef.current;
    if (!surface || !indicator) return;
    selectorAnimationRef.current?.cancel();

    if (shouldReduceMotion()) {
      surface.style.transform = 'scale(1, 1)';
      return;
    }

    const preset = LIQUID_GLASS_TABS_PRESET.selectorSpring;
    const width = Math.max(1, indicator.offsetWidth);
    const height = Math.max(1, indicator.offsetHeight);
    const firstScaleY = Math.max(.45, 1 - preset.firstHeightShrinkPercent / 100);
    const targetFirstWidth = height * preset.firstWidthToHeightPercent / 100;
    const firstScaleX = Math.max(.20, Math.min(1, targetFirstWidth / width));
    const secondScaleX = Math.max(.55, 1 - preset.secondWidthShrinkPercent / 100);
    const secondScaleY = Math.max(.60, 1 - preset.secondHeightShrinkPercent / 100);
    const firstPoint = clamp(preset.firstSquashPointPercent / 100, .05, .40);
    const returnPoint = clamp(preset.firstReturnPointPercent / 100, firstPoint + .08, .72);
    const secondPoint = clamp(preset.secondSquashPointPercent / 100, returnPoint + .08, .94);

    surface.style.transform = 'scale(1, 1)';
    selectorAnimationRef.current = surface.animate(
      [
        { transform: 'scale(1, 1)', offset: 0, easing: 'cubic-bezier(.30,0,.25,1)' },
        { transform: `scale(${firstScaleX}, ${firstScaleY})`, offset: firstPoint, easing: 'cubic-bezier(.18,.89,.32,1.12)' },
        { transform: 'scale(1, 1)', offset: returnPoint, easing: 'cubic-bezier(.16,1,.30,1)' },
        { transform: `scale(${secondScaleX}, ${secondScaleY})`, offset: secondPoint, easing: 'ease-out' },
        { transform: 'scale(1, 1)', offset: 1, easing: 'ease-out' },
      ],
      { duration: preset.durationMs, easing: 'linear' },
    );
    selectorAnimationRef.current.onfinish = () => {
      surface.style.transform = 'scale(1, 1)';
      selectorAnimationRef.current?.cancel();
      selectorAnimationRef.current = null;
    };
  }, [indicatorRef, indicatorSurfaceRef]);

  const clearPressIntent = useCallback(() => {
    if (pressIntentTimerRef.current !== null) {
      window.clearTimeout(pressIntentTimerRef.current);
      pressIntentTimerRef.current = null;
    }
  }, []);

  const stopRafIfIdle = useCallback(() => {
    if (phaseRef.current || rafRef.current === null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const finishPhase = useCallback((target: HTMLButtonElement) => {
    const root = rootRef.current;
    const lens = lensRef.current;
    const surface = indicatorSurfaceRef.current;
    const token = interactionTokenRef.current;

    phaseRef.current = null;
    snapIndicatorTo(target);
    if (surface) surface.style.transform = 'scale(1, 1)';
    if (root) root.dataset.liquidGlassActive = 'false';
    if (lens) lens.removeAttribute('data-liquid-glass-visible');
    if (root && !rootAnimationRef.current) root.style.scale = '1';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (interactionTokenRef.current !== token || phaseRef.current) return;
        startSelectorSpring();
      });
    });

    stopRafIfIdle();
  }, [indicatorSurfaceRef, rootRef, snapIndicatorTo, startSelectorSpring, stopRafIfIdle]);

  const phaseProgress = useCallback((phase: LiquidGlassPhase, now: number) => {
    const elapsed = now - phase.startTime;
    if (phase.kind === 'different') {
      return liquidGlassDifferentTabProgress(elapsed, phase.travelMs, phase.pressed, phase.closeStartAt);
    }
    return liquidGlassSameTabProgress(elapsed, phase.travelMs, phase.pressed, phase.progressAtRelease, phase.closeStartAt);
  }, []);

  const renderImpact = useCallback((phase: LiquidGlassPhase, now: number) => {
    if (phase.pressed || phase.closeStartAt === null || phase.impactStarted) return;

    const closeDuration = phase.kind === 'same'
      ? Math.max(1, phase.progressAtRelease * phase.halfMs)
      : phase.halfMs;
    const impactAt = phase.closeStartAt + closeDuration * LIQUID_GLASS_TABS_PRESET.impactPointPercent / 100;
    if (now < impactAt) return;

    phase.impactStarted = true;
    startContainerSpring();
    const target = phase.kind === 'different' ? phase.toTrigger : phase.trigger;
    if (iconSpringTimerRef.current !== null) window.clearTimeout(iconSpringTimerRef.current);
    iconSpringTimerRef.current = window.setTimeout(
      () => startIconSpring(target),
      LIQUID_GLASS_TABS_PRESET.iconSpring.delayAfterImpactMs,
    );
  }, [startContainerSpring, startIconSpring]);

  const renderFrame = useCallback((now: number) => {
    const phase = phaseRef.current;
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!phase || !list || !indicator) return;

    const progress = phaseProgress(phase, now);

    if (phase.kind === 'different') {
      const elapsed = now - phase.startTime;
      const rawTravel = clamp(elapsed / phase.travelMs, 0, 1);
      const travel = smoothstep(rawTravel);
      list.scrollLeft = lerp(phase.startScroll, phase.endScroll, travel);

      const left = lerp(phase.fromTrigger.offsetLeft, phase.toTrigger.offsetLeft, travel);
      const width = lerp(phase.fromWidth, phase.toWidth, travel);
      indicator.style.transform = `translateX(${left}px)`;
      indicator.style.width = `${width}px`;

      const contentCenter = lerp(phase.fromCenter, phase.toCenter, travel);
      renderLensGeometry(getVisibleCenter(contentCenter), width, progress);
      renderImpact(phase, now);

      if (rawTravel >= 1 && progress <= .0001) finishPhase(phase.toTrigger);
      return;
    }

    const center = getVisibleCenter(getTriggerContentCenter(phase.trigger));
    snapIndicatorTo(phase.trigger);
    renderLensGeometry(center, phase.trigger.offsetWidth, progress);
    renderImpact(phase, now);
    if (!phase.pressed && phase.closeStartAt !== null && now >= phase.closeStartAt && progress <= .0001) {
      finishPhase(phase.trigger);
    }
  }, [finishPhase, getTriggerContentCenter, getVisibleCenter, indicatorRef, listRef, phaseProgress, renderImpact, renderLensGeometry, snapIndicatorTo]);

  const ensureRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    const tick = (now: number) => {
      renderFrame(now);
      if (phaseRef.current) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [renderFrame]);

  const beginPhaseVisuals = useCallback((target: HTMLButtonElement) => {
    const root = rootRef.current;
    const lens = lensRef.current;
    const surface = indicatorSurfaceRef.current;
    selectorAnimationRef.current?.cancel();
    selectorAnimationRef.current = null;
    if (surface) surface.style.transform = 'scale(1, 1)';
    prepareLensOptics(target.offsetWidth);
    if (root) root.dataset.liquidGlassActive = 'true';
    if (lens) lens.dataset.liquidGlassVisible = 'true';
    startRootExpansion();
  }, [indicatorSurfaceRef, prepareLensOptics, rootRef, startRootExpansion]);

  const startDifferentPhase = useCallback((fromTrigger: HTMLButtonElement, toTrigger: HTMLButtonElement, pressed: boolean, startTime: number) => {
    const list = listRef.current;
    if (!list) return;
    interactionTokenRef.current += 1;
    beginPhaseVisuals(toTrigger);
    phaseRef.current = {
      kind: 'different',
      fromTrigger,
      toTrigger,
      startTime,
      travelMs: LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs,
      halfMs: LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs / 2,
      fromCenter: getTriggerContentCenter(fromTrigger),
      toCenter: getTriggerContentCenter(toTrigger),
      fromWidth: fromTrigger.offsetWidth,
      toWidth: toTrigger.offsetWidth,
      startScroll: list.scrollLeft,
      endScroll: targetScrollFor(toTrigger),
      pressed,
      closeStartAt: pressed ? null : LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs / 2,
      impactStarted: false,
    };
    ensureRaf();
  }, [beginPhaseVisuals, ensureRaf, getTriggerContentCenter, listRef, targetScrollFor]);

  const startSamePhase = useCallback((trigger: HTMLButtonElement, startTime: number, pressed: boolean, progressAtRelease = 0) => {
    interactionTokenRef.current += 1;
    beginPhaseVisuals(trigger);
    phaseRef.current = {
      kind: 'same',
      trigger,
      startTime,
      travelMs: LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs,
      halfMs: LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs / 2,
      pressed,
      progressAtRelease,
      closeStartAt: pressed ? null : LIQUID_GLASS_TABS_PRESET.releaseDelayMs,
      impactStarted: false,
    };
    ensureRaf();
  }, [beginPhaseVisuals, ensureRaf]);

  const releasePhase = useCallback((now: number) => {
    const phase = phaseRef.current;
    if (!phase) return;
    phase.pressed = false;

    if (phase.kind === 'different') {
      const elapsed = now - phase.startTime;
      phase.closeStartAt = elapsed < phase.halfMs
        ? phase.halfMs
        : elapsed + LIQUID_GLASS_TABS_PRESET.releaseDelayMs;
      return;
    }

    const elapsed = now - phase.startTime;
    phase.progressAtRelease = clamp(elapsed / phase.halfMs, 0, 1);
    phase.closeStartAt = elapsed + LIQUID_GLASS_TABS_PRESET.releaseDelayMs;
  }, []);

  const abortPhaseForSwipe = useCallback(() => {
    interactionTokenRef.current += 1;
    phaseRef.current = null;
    const root = rootRef.current;
    const lens = lensRef.current;
    const surface = indicatorSurfaceRef.current;
    if (root) {
      root.dataset.liquidGlassActive = 'false';
      root.style.scale = '1';
    }
    if (lens) lens.removeAttribute('data-liquid-glass-visible');
    if (surface) surface.style.transform = 'scale(1, 1)';
    rootAnimationRef.current?.cancel();
    rootAnimationRef.current = null;
    selectorAnimationRef.current?.cancel();
    selectorAnimationRef.current = null;
    snapIndicatorTo(getActiveTrigger());
    suppressClickUntilRef.current = performance.now() + 450;
    stopRafIfIdle();
  }, [getActiveTrigger, indicatorSurfaceRef, rootRef, snapIndicatorTo, stopRafIfIdle]);

  const findTriggerFromEvent = useCallback((eventTarget: EventTarget | null) => {
    const list = listRef.current;
    if (!list || !(eventTarget instanceof Element)) return null;
    const trigger = eventTarget.closest<HTMLButtonElement>('.ui-tabs__trigger');
    if (!trigger || !list.contains(trigger) || trigger.disabled) return null;
    return trigger;
  }, [listRef]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || shouldReduceMotion()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = findTriggerFromEvent(event.target);
    const active = getActiveTrigger();
    if (!target || !active) return;

    clearPressIntent();
    const gesture: LiquidGlassGesture = {
      pointerId: event.pointerId,
      target,
      downAt: performance.now(),
      x: event.clientX,
      y: event.clientY,
      swipe: false,
      started: false,
      same: target === active,
    };
    gestureRef.current = gesture;

    pressIntentTimerRef.current = window.setTimeout(() => {
      const current = gestureRef.current;
      if (current !== gesture || current.swipe) return;
      current.started = true;
      if (current.same) startSamePhase(current.target, current.downAt, true);
      else startDifferentPhase(active, current.target, true, performance.now());
    }, LIQUID_GLASS_TABS_PRESET.pressIntentDelayMs);
  }, [clearPressIntent, enabled, findTriggerFromEvent, getActiveTrigger, startDifferentPhase, startSamePhase]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.swipe) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) < LIQUID_GLASS_TABS_PRESET.swipeThresholdPx || Math.abs(dx) <= Math.abs(dy)) return;

    gesture.swipe = true;
    clearPressIntent();
    if (gesture.started) abortPhaseForSwipe();
    else suppressClickUntilRef.current = performance.now() + 450;
  }, [abortPhaseForSwipe, clearPressIntent, enabled]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || shouldReduceMotion()) return;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearPressIntent();

    if (gesture.swipe) {
      gestureRef.current = null;
      return;
    }

    const now = performance.now();
    if (!gesture.started) {
      const active = getActiveTrigger();
      if (!active) {
        gestureRef.current = null;
        return;
      }

      if (gesture.target === active) {
        const progress = clamp((now - gesture.downAt) / (LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs / 2), 0, 1);
        startSamePhase(gesture.target, now, false, progress);
      } else {
        startDifferentPhase(active, gesture.target, false, now);
      }
    } else {
      releasePhase(now);
    }

    gestureRef.current = null;
  }, [clearPressIntent, enabled, getActiveTrigger, releasePhase, startDifferentPhase, startSamePhase]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearPressIntent();
    if (gesture.started && !gesture.swipe) releasePhase(performance.now());
    else if (gesture.started) abortPhaseForSwipe();
    gestureRef.current = null;
  }, [abortPhaseForSwipe, clearPressIntent, enabled, releasePhase]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!enabled || performance.now() >= suppressClickUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, [enabled]);

  useEffect(() => () => {
    clearPressIntent();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (iconSpringTimerRef.current !== null) window.clearTimeout(iconSpringTimerRef.current);
    rootAnimationRef.current?.cancel();
    selectorAnimationRef.current?.cancel();
    iconAnimationsRef.current.forEach((animation) => animation.cancel());
    iconAnimationsRef.current.clear();
  }, [clearPressIntent]);

  const listStyle = enabled
    ? { '--ui-liquid-glass-filter': `url(#${containerFilterId})` } as CSSProperties
    : undefined;
  const lensStyle = enabled
    ? { '--ui-liquid-glass-filter': `url(#${lensFilterId})` } as CSSProperties
    : undefined;

  return {
    lensRef,
    listStyle,
    lensStyle,
    containerFilter: enabled ? <LiquidGlassOpticalFilter id={containerFilterId} geometry={containerGeometry} region="container" /> : null,
    lensFilter: enabled ? <LiquidGlassOpticalFilter id={lensFilterId} geometry={lensGeometry} region="lens" /> : null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  };
}

