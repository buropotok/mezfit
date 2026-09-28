// Frozen DaySchedule-owned snapshot of the approved Text Only interaction runtime.
// Direct extraction of the approved Text Only prototype interaction model.
// React owns identity/controlled value; this private runtime owns the tuned gesture optics.
export function mountPrototype(root, initialIndex) {
  const owner = root.ownerDocument;
  const win = owner.defaultView;
  const pane = root.getElementById('toolbar-pane');
  const tabStrip = root.getElementById('tab-strip');
  const selectorTrack = root.getElementById('selector-track');
  const selector = root.getElementById('selector');
  const lensTrack = root.getElementById('lens-track');
  const lens = root.getElementById('lens');
  const filter = root.getElementById('standalone-lens-filter');
  const links = [...tabStrip.querySelectorAll('.tab-link')];

  const timers = new Set();
  const frames = new Set();
  const observers = new Set();
  const animations = new Set();
  const disposers = [];
  let disposed = false;

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    disposers.push(() => target.removeEventListener(type, callback, options));
  }
  function later(callback, delay) {
    const id = globalThis.setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
    }, delay);
    timers.add(id);
    return id;
  }
  function clearLater(id) {
    if (id == null) return;
    globalThis.clearTimeout(id);
    timers.delete(id);
  }
  function frame(callback) {
    const id = globalThis.requestAnimationFrame(time => {
      frames.delete(id);
      if (!disposed) callback(time);
    });
    frames.add(id);
    return id;
  }
  function cancelFrame(id) {
    if (!id) return;
    globalThis.cancelAnimationFrame(id);
    frames.delete(id);
  }
  function animate(element, keyframes, options) {
    if (!element.animate) return null;
    const animation = element.animate(keyframes, options);
    animations.add(animation);
    const forget = () => animations.delete(animation);
    animation.addEventListener?.('finish', forget, { once: true });
    animation.addEventListener?.('cancel', forget, { once: true });
    return animation;
  }
  function observe(observer, target) {
    observers.add(observer);
    observer.observe(target);
    return observer;
  }

  const TRAVEL_MS = 300;
  const PANE_EXPANDED_SCALE = 1.05;
  const LENS_PRESSED_SCALE = 1.25;

  const data = {
    activeIndex: Math.max(0, Math.min(initialIndex, links.length - 1)),
    newActiveIndex: Math.max(0, Math.min(initialIndex, links.length - 1)),
    springTimer: null,
    springAnimation: null,
    paneResetTimer: null,
    selectionTravelRaf: 0,
    selectionTravelActive: false,
    paneSyncRaf: 0,
    paneSyncUntil: 0,
    lensAnchorLeft: 0,
    lensAnchorWidth: 0,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => win?.performance?.now?.() ?? performance.now();

  function geometryFor(link) {
    if (!link) return { left: 0, width: 0 };
    return { left: link.offsetLeft, width: link.offsetWidth };
  }

  function positionSelector(index, animated = true) {
    const link = links[index];
    if (!link) return;
    const geometry = geometryFor(link);
    selectorTrack.style.transitionDuration = animated ? `${TRAVEL_MS}ms` : '0ms';
    selectorTrack.style.width = `${geometry.width}px`;
    selectorTrack.style.transform = `translateX(${geometry.left}px)`;
  }

  function paneScale() {
    if (!pane.offsetWidth) return 1;
    return pane.getBoundingClientRect().width / pane.offsetWidth || 1;
  }

  function lensExpansionProgress(scale = paneScale()) {
    const range = PANE_EXPANDED_SCALE - 1;
    if (range <= 0) return 1;
    return clamp((scale - 1) / range, 0, 1);
  }

  function lensGeometry(contentLeft, slotWidth, scrollLeft = tabStrip.scrollLeft) {
    const scale = paneScale();
    const progress = lensExpansionProgress(scale);
    const lensScale = 1 + (LENS_PRESSED_SCALE - 1) * progress;
    const innerHeight = pane.offsetHeight * scale;
    const innerWidth = slotWidth * scale;
    const height = innerHeight * lensScale;
    const radialOffset = (height - innerHeight) / 2;
    const width = Math.max(height, innerWidth + radialOffset * 2);
    const rawCenter = contentLeft - scrollLeft + slotWidth / 2;
    const paneCenter = pane.offsetWidth / 2;
    const visualCenter = paneCenter + (rawCenter - paneCenter) * scale;
    return {
      left: visualCenter - width / 2,
      width,
      height,
      top: (pane.offsetHeight - height) / 2,
      radius: height / 2,
    };
  }

  function setLensAnchor(contentLeft, width) {
    data.lensAnchorLeft = contentLeft;
    data.lensAnchorWidth = width;
  }

  function syncLensTrackToAnchor() {
    if (data.lensAnchorWidth <= 0) return;
    const geometry = lensGeometry(data.lensAnchorLeft, data.lensAnchorWidth, tabStrip.scrollLeft);
    lensTrack.style.width = `${geometry.width}px`;
    lensTrack.style.height = `${geometry.height}px`;
    lensTrack.style.top = `${geometry.top}px`;
    lensTrack.style.borderRadius = `${geometry.radius}px`;
    lensTrack.style.transform = `translateX(${geometry.left}px)`;
  }

  function positionLensTrack(index, animated = true) {
    const link = links[index];
    if (!link) return;
    const geometry = geometryFor(link);
    lensTrack.style.transitionDuration = animated ? `${TRAVEL_MS}ms` : '0ms';
    setLensAnchor(geometry.left, geometry.width);
    syncLensTrackToAnchor();
  }

  function syncPaneCoupledLensFor(duration = 340) {
    data.paneSyncUntil = Math.max(data.paneSyncUntil, now() + duration);
    if (data.paneSyncRaf) return;
    const render = time => {
      if (!data.selectionTravelActive) syncLensTrackToAnchor();
      if (time < data.paneSyncUntil) {
        data.paneSyncRaf = frame(render);
        return;
      }
      data.paneSyncRaf = 0;
      data.paneSyncUntil = 0;
      if (!data.selectionTravelActive) syncLensTrackToAnchor();
    };
    data.paneSyncRaf = frame(render);
  }

  function cancelSelectionTravel() {
    cancelFrame(data.selectionTravelRaf);
    data.selectionTravelRaf = 0;
    data.selectionTravelActive = false;
  }

  function targetScrollFor(index, startScroll = tabStrip.scrollLeft) {
    const selected = links[index];
    if (!selected) return startScroll;
    const viewport = tabStrip.clientWidth;
    const maxScroll = Math.max(0, tabStrip.scrollWidth - viewport);
    if (maxScroll <= 0) return 0;
    const visibleLeft = startScroll;
    const visibleRight = visibleLeft + viewport;
    const selectedLeft = selected.offsetLeft;
    const selectedRight = selectedLeft + selected.offsetWidth;
    let target = startScroll;

    if (index === 0) {
      if (selectedLeft < visibleLeft || selectedRight > visibleRight) target = selectedLeft;
    } else if (index === links.length - 1) {
      if (selectedLeft < visibleLeft || selectedRight > visibleRight) target = selectedRight - viewport;
    } else {
      const previous = links[index - 1];
      const next = links[index + 1];
      const previousLeft = previous.offsetLeft;
      const nextRight = next.offsetLeft + next.offsetWidth;
      const leftGap = selectedLeft - visibleLeft;
      const rightGap = visibleRight - selectedRight;
      if (leftGap <= rightGap) {
        if (previousLeft < visibleLeft - .5) target = previousLeft;
      } else if (nextRight > visibleRight + .5) {
        target = nextRight - viewport;
      }
      if (selectedLeft < visibleLeft) target = Math.min(target, selectedLeft);
      else if (selectedRight > visibleRight) target = Math.max(target, selectedRight - viewport);
    }
    return clamp(target, 0, maxScroll);
  }

  function cubicBezierCoordinate(t, p1, p2) {
    const oneMinusT = 1 - t;
    return 3 * oneMinusT * oneMinusT * t * p1 + 3 * oneMinusT * t * t * p2 + t * t * t;
  }

  function travelEase(progress) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2;
      const x = cubicBezierCoordinate(mid, 0, .58);
      if (x < progress) low = mid;
      else high = mid;
    }
    return cubicBezierCoordinate((low + high) / 2, 0, 1);
  }

  function setActive(index) {
    if (!links[index]) return;
    data.activeIndex = index;
    data.newActiveIndex = index;
    links.forEach((link, i) => {
      const active = i === index;
      link.classList.toggle('active', active);
      link.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function animateSelectionTravel(index, animated = true, onComplete = null) {
    const target = links[index];
    const from = links[data.activeIndex];
    if (!target || !from) return false;
    const fromGeometry = data.selectionTravelActive && data.lensAnchorWidth > 0
      ? { left: data.lensAnchorLeft, width: data.lensAnchorWidth }
      : geometryFor(from);
    cancelSelectionTravel();
    const toGeometry = geometryFor(target);
    const startScroll = tabStrip.scrollLeft;
    const endScroll = targetScrollFor(index, startScroll);
    setActive(index);
    selectorTrack.style.transitionDuration = '0ms';
    lensTrack.style.transitionDuration = '0ms';

    if (!animated) {
      tabStrip.scrollLeft = endScroll;
      positionSelector(index, false);
      positionLensTrack(index, false);
      onComplete?.();
      return false;
    }

    const startedAt = now();
    data.selectionTravelActive = true;
    const render = time => {
      const raw = clamp((time - startedAt) / TRAVEL_MS, 0, 1);
      const progress = travelEase(raw);
      const scrollLeft = startScroll + (endScroll - startScroll) * progress;
      const contentLeft = fromGeometry.left + (toGeometry.left - fromGeometry.left) * progress;
      const width = fromGeometry.width + (toGeometry.width - fromGeometry.width) * progress;
      tabStrip.scrollLeft = scrollLeft;
      selectorTrack.style.width = `${width}px`;
      selectorTrack.style.transform = `translateX(${contentLeft}px)`;
      setLensAnchor(contentLeft, width);
      syncLensTrackToAnchor();
      if (raw < 1) {
        data.selectionTravelRaf = frame(render);
        return;
      }
      data.selectionTravelRaf = 0;
      data.selectionTravelActive = false;
      tabStrip.scrollLeft = endScroll;
      positionSelector(index, false);
      positionLensTrack(index, false);
      onComplete?.();
    };
    data.selectionTravelRaf = frame(render);
    return true;
  }

  function restorePane() {
    clearLater(data.paneResetTimer);
    pane.style.transitionDuration = '300ms';
    pane.style.transitionTimingFunction = 'ease-in-out';
    pane.style.scale = '';
    syncPaneCoupledLensFor(340);
    data.paneResetTimer = later(() => {
      pane.style.transitionDuration = '';
      pane.style.transitionTimingFunction = '';
    }, 340);
  }

  function expandPane() {
    clearLater(data.paneResetTimer);
    pane.style.transitionDuration = '300ms';
    pane.style.transitionTimingFunction = 'ease-in-out';
    pane.style.scale = String(PANE_EXPANDED_SCALE);
    syncPaneCoupledLensFor(340);
  }

  function clearSpring() {
    clearLater(data.springTimer);
    data.springTimer = null;
    if (data.springAnimation) {
      data.springAnimation.cancel();
      animations.delete(data.springAnimation);
      data.springAnimation = null;
    }
  }

  function sampledSpringKeyframes() {
    const duration = 600;
    const p1Time = 78;
    const p2Time = 479;
    const x1 = .92, x2 = 1.02, y1 = 1.09, y2 = .99;
    const xBend1 = .88, xBend2 = 1.03, yBend1 = 1.14, yBend2 = .98;
    const bendTime = index => index === 1
      ? p1Time + Math.min(46, Math.max(18, (p2Time - p1Time) * .34))
      : p2Time + Math.min(46, Math.max(18, (duration - p2Time) * .42));
    const tangent = (axis, index) => {
      const amp = axis === 'x' ? (index === 1 ? x1 : x2) : (index === 1 ? y1 : y2);
      const bend = axis === 'x' ? (index === 1 ? xBend1 : xBend2) : (index === 1 ? yBend1 : yBend2);
      const pointTime = index === 1 ? p1Time : p2Time;
      return (bend - amp) / Math.max(1, bendTime(index) - pointTime);
    };
    const hermite = (time, t0, y0, m0, t1, y1v, m1) => {
      const dt = Math.max(1, t1 - t0);
      const u = clamp((time - t0) / dt, 0, 1);
      const u2 = u * u, u3 = u2 * u;
      return (2*u3 - 3*u2 + 1) * y0 + (u3 - 2*u2 + u) * dt * m0 + (-2*u3 + 3*u2) * y1v + (u3 - u2) * dt * m1;
    };
    const curveValue = (axis, time) => {
      const v1 = axis === 'x' ? x1 : y1;
      const v2 = axis === 'x' ? x2 : y2;
      const m1 = tangent(axis, 1), m2 = tangent(axis, 2);
      if (time <= p1Time) return hermite(time, 0, 1, 0, p1Time, v1, m1);
      if (time <= p2Time) return hermite(time, p1Time, v1, m1, p2Time, v2, m2);
      return hermite(time, p2Time, v2, m2, duration, 1, 0);
    };
    const framesOut = [];
    for (let i = 0; i <= 64; i++) {
      const time = duration * (i / 64);
      framesOut.push({
        transform: `scale(${curveValue('x', time).toFixed(4)}, ${curveValue('y', time).toFixed(4)})`,
        offset: i / 64,
      });
    }
    return framesOut;
  }

  function releaseTapVisuals() {
    lens.classList.remove('tap-spring-active');
    selector.classList.remove('tap-spring-hidden');
    restorePane();
  }

  function playTapSpring() {
    clearSpring();
    lens.classList.add('tap-spring-active');
    selector.classList.add('tap-spring-hidden');
    const animation = animate(lens, sampledSpringKeyframes(), { duration: 600, fill: 'none', easing: 'linear' });
    if (!animation) {
      data.springTimer = later(releaseTapVisuals, 600);
      return;
    }
    data.springAnimation = animation;
    const finish = () => {
      if (data.springAnimation === animation) data.springAnimation = null;
      releaseTapVisuals();
    };
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', () => {
      if (data.springAnimation === animation) data.springAnimation = null;
    }, { once: true });
  }

  function startTapTravel(index) {
    clearSpring();
    expandPane();
    lens.classList.add('tap-spring-active');
    selector.classList.add('tap-spring-hidden');
    animateSelectionTravel(index, true, playTapSpring);
  }

  const layoutObserver = observe(new globalThis.ResizeObserver(() => {
    positionSelector(data.activeIndex, false);
    positionLensTrack(data.activeIndex, false);
  }), tabStrip);
  links.forEach(link => layoutObserver.observe(link));

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

  filter.innerHTML = `
    <feImage id="optical-vector-image" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="vectorMap"></feImage>
    <feDisplacementMap id="optical-disp-r" in="SourceGraphic" in2="vectorMap" scale="8.1" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    <feColorMatrix type="matrix" result="redPass" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"></feColorMatrix>
    <feDisplacementMap id="optical-disp-g" in="SourceGraphic" in2="vectorMap" scale="8" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    <feColorMatrix type="matrix" result="greenPass" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"></feColorMatrix>
    <feDisplacementMap id="optical-disp-b" in="SourceGraphic" in2="vectorMap" scale="7.9" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    <feColorMatrix type="matrix" result="bluePass" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"></feColorMatrix>
    <feBlend in="redPass" in2="greenPass" mode="screen" result="rg"></feBlend>
    <feBlend in="rg" in2="bluePass" mode="screen"></feBlend>`;

  const vectorImage = root.getElementById('optical-vector-image');
  const dispR = root.getElementById('optical-disp-r');
  const dispG = root.getElementById('optical-disp-g');
  const dispB = root.getElementById('optical-disp-b');
  const work = owner.createElement('canvas');
  const ctx = work.getContext('2d', { willReadFrequently: true });

  function capsuleSdf(x, y, halfW, halfH) {
    const radius = halfH;
    const qx = Math.abs(x) - Math.max(0, halfW - radius);
    const qy = Math.abs(y);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
  }

  function buildVectorMap() {
    if (!ctx || !vectorImage || !dispR || !dispG || !dispB) return;
    const width = Math.max(1, lens.offsetWidth);
    const height = Math.max(1, lens.offsetHeight);
    const sampleScale = Math.max(1.5, Math.min(3, win?.devicePixelRatio || 1.5));
    const w = Math.max(128, Math.round(width * sampleScale));
    const h = Math.max(72, Math.round(height * sampleScale));
    work.width = w;
    work.height = h;
    const sx = w / width, sy = h / height, halfW = width / 2, halfH = height / 2;
    const image = ctx.createImageData(w, h);
    const pixels = image.data;

    for (let j = 0; j < h; j++) {
      const y = (j + .5) / sy - halfH;
      for (let i = 0; i < w; i++) {
        const x = (i + .5) / sx - halfW;
        const sdf = capsuleSdf(x, y, halfW, halfH);
        const d = -sdf;
        let vx = 0, vy = 0;
        if (d > OPTICS.neutralEdge) {
          const eps = .35;
          const gx = capsuleSdf(x + eps, y, halfW, halfH) - capsuleSdf(x - eps, y, halfW, halfH);
          const gy = capsuleSdf(x, y + eps, halfW, halfH) - capsuleSdf(x, y - eps, halfW, halfH);
          const length = Math.hypot(gx, gy) || 1;
          const local = d - OPTICS.neutralEdge;
          let magnitude = 0;
          if (local < OPTICS.rimWidth) magnitude += Math.sin(Math.PI * (local / OPTICS.rimWidth)) * OPTICS.rimStrength;
          if (local >= OPTICS.rimWidth && local < OPTICS.rimWidth + OPTICS.trenchWidth) {
            const t = (local - OPTICS.rimWidth) / Math.max(.001, OPTICS.trenchWidth);
            magnitude -= Math.sin(Math.PI * t) * OPTICS.trenchStrength;
          }
          vx = (gx / length) * magnitude;
          vy = (gy / length) * magnitude;
        }
        const p = (j * w + i) * 4;
        pixels[p] = Math.round(clamp(128 + vx * 127, 0, 255));
        pixels[p + 1] = Math.round(clamp(128 + vy * 127, 0, 255));
        pixels[p + 2] = 128;
        pixels[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    vectorImage.setAttribute('href', work.toDataURL('image/png'));
    vectorImage.setAttribute('width', String(width));
    vectorImage.setAttribute('height', String(height));
    dispR.setAttribute('scale', String(OPTICS.refraction + OPTICS.rgbSpread));
    dispG.setAttribute('scale', String(OPTICS.refraction));
    dispB.setAttribute('scale', String(Math.max(0, OPTICS.refraction - OPTICS.rgbSpread)));
    filter.setAttribute('x', `${-OPTICS.padding}%`);
    filter.setAttribute('y', `${-OPTICS.padding}%`);
    filter.setAttribute('width', `${100 + OPTICS.padding * 2}%`);
    filter.setAttribute('height', `${100 + OPTICS.padding * 2}%`);
  }

  frame(() => frame(buildVectorMap));
  const lensObserver = observe(new globalThis.ResizeObserver(buildVectorMap), lens);
  if (win) listen(win, 'resize', buildVectorMap, { passive: true });

  setActive(data.activeIndex);
  frame(() => {
    positionSelector(data.activeIndex, false);
    positionLensTrack(data.activeIndex, false);
  });

  function resetValue(index) {
    cancelSelectionTravel();
    cancelFrame(data.paneSyncRaf);
    data.paneSyncRaf = 0;
    data.paneSyncUntil = 0;
    clearSpring();
    timers.forEach(id => globalThis.clearTimeout(id));
    timers.clear();
    lens.classList.remove('tap-spring-active', 'pressed');
    selector.classList.remove('tap-spring-hidden', 'pressed');
    pane.style.scale = '';
    pane.style.transitionDuration = '0ms';
    setActive(index);
    positionSelector(index, false);
    positionLensTrack(index, false);
  }

  return {
    playTap(index) { startTapTravel(index); },
    resetValue,
    setValue(index) {
      if (!links[index]) return;
      if (index === data.activeIndex) {
        setActive(index);
        return;
      }
      clearSpring();
      expandPane();
      lens.classList.add('tap-spring-active');
      selector.classList.add('tap-spring-hidden');
      animateSelectionTravel(index, true, playTapSpring);
    },
    dispose() {
      disposed = true;
      cancelSelectionTravel();
      cancelFrame(data.paneSyncRaf);
      data.paneSyncRaf = 0;
      clearSpring();
      timers.forEach(id => globalThis.clearTimeout(id));
      timers.clear();
      frames.forEach(id => globalThis.cancelAnimationFrame(id));
      frames.clear();
      animations.forEach(animation => animation.cancel());
      animations.clear();
      observers.forEach(observer => observer.disconnect());
      observers.clear();
      disposers.forEach(dispose => dispose());
      disposers.length = 0;
      void layoutObserver;
      void lensObserver;
    },
  };
}

