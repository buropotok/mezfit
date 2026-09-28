// Private entrance runtime for LiquidGlassTabsNoFab.
// React/UI Kit owns the settled tabs; this module owns only the temporary center-spread optics.
export function mountPrototype(root, tabsHost, playEntrance) {
  const scene = root.getElementById('startupScene');
  const vector = root.getElementById('startup-vector');
  const maskSurface = root.getElementById('startup-mask-surface');
  const bezelSurface = root.getElementById('startup-bezel-surface');
  const iconsFo = root.getElementById('startup-icons-fo');
  const materialSurface = root.getElementById('startup-material-surface');
  const backdropLayer = root.getElementById('startup-backdrop-layer');
  const saturationNode = root.getElementById('startup-lens-saturation');
  const refraction = root.getElementById('startup-refraction-icons');

  const frames = new Set();
  const observers = new Set();
  let disposed = false;
  let running = false;
  let width = 0;
  let height = 0;
  let baseY = 0;
  let sigma = 36;
  let bx = 0;
  let by = 0;
  let cx = 0;
  let cy = 0;
  let timing = null;
  let path = [];
  let splitU = null;
  let startTime = 0;
  let handoffProgress = 0;
  let bezelFrame = 0;

  const SETTINGS = {
    pauseSec: .30,
    revealSec: .75,
    handoffSec: .16,
    speed: 500,
    lensScale: 1.14,
    blurPx: .7,
    saturation: 1.29,
    frost: .14,
    speedPoints: [0, .186, .360, .577, 0],
  };

  const threshold = .46;
  const logThreshold = -Math.log(threshold);
  const nodes = [{ x: 0, y: 0 }, { x: .21, y: .88 }, { x: .47, y: 1 }, { x: .78, y: .88 }, { x: 1, y: 0 }];
  const mapCanvas = document.createElement('canvas');
  const mapCtx = mapCanvas.getContext('2d');
  const bezelCanvas = document.createElement('canvas');
  const bezelCtx = bezelCanvas.getContext('2d');
  const speedIntegral = new Float32Array(257);
  const fieldAmpLookup = new Float32Array(2049);
  const profileLookup = new Float32Array(1025);
  let fieldAmpLookupReady = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function requestFrame(callback) {
    const id = globalThis.requestAnimationFrame(time => {
      frames.delete(id);
      if (!disposed) callback(time);
    });
    frames.add(id);
    return id;
  }

  class RuntimeResizeObserver extends globalThis.ResizeObserver {
    constructor(callback) {
      super(callback);
      observers.add(this);
    }
  }

  function baseSigma() {
    return Math.max(12, Math.min(40, width / 8));
  }

  function applyLensSize() {
    sigma = SETTINGS.lensScale * baseSigma();
  }

  function halfSpan() {
    return Math.max(1, width / 2 / 1.1 - 32);
  }

  function movingSigma(x) {
    const t = clamp(x / halfSpan(), 0, 1);
    const blend = t * t * (3 - 2 * t);
    const finalSigma = 32 / Math.sqrt(2 * Math.log(2 / threshold));
    return sigma + (finalSigma - sigma) * blend;
  }

  function bridgeWeight(x) {
    const a = clamp(x / halfSpan(), 0, 1);
    const smooth = a * a * (3 - 2 * a);
    return Math.max(smooth, .28 * (1 - Math.exp(-x * x / (2 * movingSigma(x) ** 2))));
  }

  function catmull1D(a, b, c, d, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }

  function speedValueAt(u) {
    if (u <= 0 || u >= 1) return 0;
    const scaled = u * 4;
    const i = Math.min(3, Math.max(0, Math.floor(scaled)));
    const t = scaled - i;
    const p = SETTINGS.speedPoints;
    return clamp(catmull1D(p[Math.max(0, i - 1)], p[i], p[i + 1], p[Math.min(4, i + 2)], t), 0, 1.15);
  }

  function rebuildSpeedIntegral() {
    let area = 0;
    let previous = speedValueAt(0);
    speedIntegral[0] = 0;
    for (let i = 1; i < speedIntegral.length; i++) {
      const u = i / (speedIntegral.length - 1);
      const value = speedValueAt(u);
      area += (previous + value) / 2 / (speedIntegral.length - 1);
      speedIntegral[i] = area;
      previous = value;
    }
    if (area < 1e-6) {
      for (let i = 0; i < speedIntegral.length; i++) speedIntegral[i] = i / (speedIntegral.length - 1);
      return;
    }
    for (let i = 1; i < speedIntegral.length; i++) speedIntegral[i] /= area;
  }

  function speedAreaAt(u) {
    const x = clamp(u, 0, 1) * (speedIntegral.length - 1);
    const i = Math.floor(x);
    const q = x - i;
    const a = speedIntegral[i];
    const b = speedIntegral[Math.min(i + 1, speedIntegral.length - 1)];
    return a + (b - a) * q;
  }

  function profile(x) {
    x = clamp(x, 0, 1);
    let i = 0;
    while (i < nodes.length - 2 && x > nodes[i + 1].x) i++;
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[i];
    const c = nodes[i + 1];
    const d = nodes[Math.min(nodes.length - 1, i + 2)];
    const t = (x - b.x) / (c.x - b.x);
    const t2 = t * t;
    const t3 = t2 * t;
    return .5 * ((2 * b.y) + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3);
  }

  for (let i = 0; i < profileLookup.length; i++) profileLookup[i] = profile(i / (profileLookup.length - 1));

  function ensureFieldAmpLookup() {
    if (fieldAmpLookupReady) return;
    for (let i = 0; i < fieldAmpLookup.length; i++) {
      const value = i / (fieldAmpLookup.length - 1) * 2.4;
      const normalized = value > 1e-8
        ? Math.sqrt(Math.max(0, -Math.log(value)) / logThreshold)
        : 1;
      fieldAmpLookup[i] = profileLookup[Math.round(clamp(normalized, 0, 1) * (profileLookup.length - 1))];
    }
    fieldAmpLookupReady = true;
  }

  function curve(u) {
    return { x: halfSpan() / sigma * u * u, y: 4.8 * (2 * u - u * u) };
  }

  function connected(u) {
    const p = curve(u);
    const extent = Math.ceil(halfSpan() / sigma + 3);
    const step = .12;
    const nx = Math.ceil(2 * extent / step) + 1;
    const ny = 85;
    const weight = bridgeWeight(p.x * sigma);
    const ratio = movingSigma(p.x * sigma) / sigma;
    const movingDen = 2 * ratio * ratio;
    const grid = new Uint8Array(nx * ny);
    const queue = new Int32Array(nx * ny);

    for (let row = 0; row < ny; row++) {
      const y = row * step - 2;
      const centerY = Math.exp(-y * y / 2);
      const movingY = Math.exp(-((y - p.y) ** 2) / movingDen);
      for (let col = 0; col < nx; col++) {
        const x = col * step - extent;
        const nearest = clamp(x, -p.x, p.x);
        const pair = (Math.exp(-((x - p.x) ** 2) / movingDen) + Math.exp(-((x + p.x) ** 2) / movingDen)) * movingY;
        const capsule = 2 * Math.exp(-((x - nearest) ** 2) / movingDen) * movingY;
        grid[row * nx + col] = Math.exp(-x * x / 2) * centerY + (1 - weight) * pair + weight * capsule >= threshold ? 1 : 0;
      }
    }

    const index = (x, y) => Math.round((y + 2) / step) * nx + Math.round((x + extent) / step);
    const from = index(0, 0);
    const target = index(p.x, p.y);
    let head = 0;
    let tail = 1;
    queue[0] = from;
    grid[from] = 2;

    while (head < tail) {
      const current = queue[head++];
      if (current === target) return true;
      const col = current % nx;
      for (const next of [col > 0 ? current - 1 : -1, col < nx - 1 ? current + 1 : -1, current - nx, current + nx]) {
        if (next >= 0 && next < grid.length && grid[next] === 1) {
          grid[next] = 2;
          queue[tail++] = next;
        }
      }
    }
    return false;
  }

  function calibrate() {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 17; i++) {
      const mid = (low + high) / 2;
      if (connected(mid)) low = mid;
      else high = mid;
    }
    splitU = (low + high) / 2;
  }

  function buildPath() {
    calibrate();
    path = [{ s: 0, x: 0, y: 0, u: 0 }];
    for (let i = 1; i <= 600; i++) {
      const u = i / 600;
      const p = curve(u);
      const previous = path[path.length - 1];
      const x = p.x * sigma;
      const y = p.y * sigma;
      path.push({ s: previous.s + Math.hypot(x - previous.x, y - previous.y), x, y, u });
    }
  }

  function arcAt(u) {
    const f = u * 600;
    const i = Math.floor(f);
    const a = path[i];
    const b = path[Math.min(i + 1, 600)];
    return a.s + (b.s - a.s) * (f - i);
  }

  function readTiming() {
    const t1 = SETTINGS.pauseSec;
    const t2 = SETTINGS.revealSec;
    const s1 = arcAt(splitU);
    const end = path[path.length - 1].s;
    const begin = Math.max(0, t1 - 1.4 * s1 / SETTINGS.speed);
    const h0 = Math.max(.001, t1 - begin);
    const h1 = Math.max(.001, t2 - t1);
    const times = [begin, t1, t2];
    const dist = [0, s1, end];
    const d0 = s1 / h0;
    const d1 = (end - s1) / h1;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    const slopes = [0, (w1 + w2) / (w1 / d0 + w2 / d1), 0];

    timing = {
      t2,
      times,
      dist,
      slopes,
      motionMs: t2 * 1000,
      handoffMs: SETTINGS.handoffSec * 1000,
      total: t2 * 1000 + SETTINGS.handoffSec * 1000,
    };
  }

  function distanceAt(t) {
    const { times, dist, slopes } = timing;
    if (t <= times[0]) return 0;
    if (t >= times[2]) return dist[2];
    let i = 0;
    while (i < 1 && t > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const u = (t - times[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * dist[i]
      + (u3 - 2 * u2 + u) * h * slopes[i]
      + (-2 * u3 + 3 * u2) * dist[i + 1]
      + (u3 - u2) * h * slopes[i + 1];
  }

  function motionSecondsAt(ms) {
    const normalized = clamp(ms / Math.max(1, timing.motionMs), 0, 1);
    return speedAreaAt(normalized) * timing.t2;
  }

  function applyMaterial() {
    if (saturationNode) saturationNode.setAttribute('values', SETTINGS.saturation.toFixed(2));
    if (backdropLayer) {
      const filter = 'blur(' + SETTINGS.blurPx.toFixed(1) + 'px) saturate(' + SETTINGS.saturation.toFixed(2) + ')';
      backdropLayer.style.backdropFilter = filter;
      backdropLayer.style.webkitBackdropFilter = filter;
    }
    if (materialSurface) {
      const alpha = (SETTINGS.frost * .01 + SETTINGS.frost * .99 * .22).toFixed(3);
      materialSurface.setAttribute('fill-opacity', alpha);
      materialSurface.setAttribute('fill', 'rgb(185,208,239)');
    }
  }

  function syncStartupIcons() {
    if (!iconsFo || !width) return;
    const runtimeWidth = width / 1.1;
    iconsFo.setAttribute('x', String((width - runtimeWidth) / 2));
    iconsFo.setAttribute('y', String(baseY - 32));
    iconsFo.setAttribute('width', String(runtimeWidth));
    iconsFo.setAttribute('height', '64');
  }

  function setTabsVisibility(progress) {
    const p = clamp(progress, 0, 1);
    tabsHost.style.opacity = String(p);
    tabsHost.style.pointerEvents = p < 1 ? 'none' : 'auto';
    tabsHost.inert = p < 1;
    if (p < 1) tabsHost.setAttribute('aria-hidden', 'true');
    else tabsHost.removeAttribute('aria-hidden');
  }

  function setInitialState() {
    handoffProgress = 0;
    scene.style.visibility = 'visible';
    scene.style.opacity = '1';
    setTabsVisibility(0);
  }

  function setFinalState() {
    handoffProgress = 1;
    scene.style.opacity = '0';
    scene.style.visibility = 'hidden';
    setTabsVisibility(1);
  }

  function setHandoffVisuals(progress) {
    const p = clamp(progress, 0, 1);
    handoffProgress = p;
    scene.style.visibility = 'visible';
    scene.style.opacity = String(1 - p);
    setTabsVisibility(p);
    if (p >= 1) setFinalState();
  }

  function prepareGeometry() {
    const nextWidth = Math.round(root.host.clientWidth);
    if (!nextWidth) return false;

    width = nextWidth;
    applyLensSize();
    buildPath();
    readTiming();
    rebuildSpeedIntegral();
    ensureFieldAmpLookup();

    const liquidRadius = sigma * Math.sqrt(-2 * Math.log(threshold));
    height = Math.max(64, Math.ceil(liquidRadius * 2 + 12));
    baseY = height / 2;

    root.host.style.setProperty('--startup-scene-height', height + 'px');
    scene.style.bottom = (32 - baseY) + 'px';
    scene.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    scene.setAttribute('width', String(width));
    scene.setAttribute('height', String(height));

    if (refraction) {
      refraction.setAttribute('filterUnits', 'userSpaceOnUse');
      refraction.setAttribute('x', '0');
      refraction.setAttribute('y', '0');
      refraction.setAttribute('width', String(width));
      refraction.setAttribute('height', String(height));
    }

    for (const element of [vector, maskSurface]) {
      if (!element) continue;
      element.setAttribute('width', String(width));
      element.setAttribute('height', String(height));
    }

    if (materialSurface) {
      materialSurface.setAttribute('width', String(width));
      materialSurface.setAttribute('height', String(height));
    }

    const resolution = Math.max(2.2, Math.sqrt(width * height / 55000));
    mapCanvas.width = Math.ceil(width / resolution);
    mapCanvas.height = Math.ceil(height / resolution);

    applyMaterial();
    syncStartupIcons();
    return true;
  }

  function pose(ms) {
    const motionEnd = timing.motionMs;
    const handoffElapsed = Math.max(0, ms - motionEnd);
    const handoffP = timing.handoffMs > 0 ? clamp(handoffElapsed / timing.handoffMs, 0, 1) : 1;
    const t = motionSecondsAt(Math.min(ms, motionEnd));
    const traveled = distanceAt(t);
    const endDistance = Math.max(1e-6, path[path.length - 1].s);
    const progress = clamp(traveled / endDistance, 0, 1);
    const x = halfSpan() * progress;
    const baseX = width / 2;

    bx = baseX - x;
    cx = baseX + x;
    by = cy = baseY;

    setHandoffVisuals(ms >= motionEnd ? handoffP : 0);
    syncStartupIcons();
  }

  function render() {
    if (!width || !mapCtx) return;

    const handoffEase = handoffProgress * handoffProgress * (3 - 2 * handoffProgress);
    const distortionStrength = 1 - Math.pow(clamp(handoffEase / .78, 0, 1), 1.15);
    const mw = mapCanvas.width;
    const mh = mapCanvas.height;
    const sx = width / mw;
    const sy = height / mh;
    const map = mapCtx.createImageData(mw, mh);
    const pixels = map.data;
    const offset = Math.abs(cx - width / 2);
    const movingS = movingSigma(offset);
    const movingDen = 2 * movingS * movingS;
    const invMovingS2 = 1 / (movingS * movingS);
    const weight = bridgeWeight(offset);
    const gainU = clamp(offset / Math.max(1, sigma * 2.2), 0, 1);
    const gainEase = gainU * gainU * (3 - 2 * gainU);
    const flowGain = .5 + .5 * gainEase;
    const xBody = new Float32Array(mw);
    const xGrad = new Float32Array(mw);

    for (let x = 0; x < mw; x++) {
      const px = (x + .5) * sx;
      const dxB = px - bx;
      const dxC = px - cx;
      const nearest = clamp(px, bx, cx);
      const dxN = px - nearest;
      const eB = Math.exp(-(dxB * dxB) / movingDen);
      const eC = Math.exp(-(dxC * dxC) / movingDen);
      const eN = 2 * Math.exp(-(dxN * dxN) / movingDen);
      xBody[x] = flowGain * ((1 - weight) * (eB + eC) + weight * eN);
      xGrad[x] = -flowGain * ((1 - weight) * (dxB * eB + dxC * eC) + weight * dxN * eN) * invMovingS2;
    }

    for (let y = 0; y < mh; y++) {
      const py = (y + .5) * sy;
      const dy = py - by;
      const yGaussian = Math.exp(-(dy * dy) / movingDen);
      const gyScale = -dy * invMovingS2;

      for (let x = 0; x < mw; x++) {
        const index = (y * mw + x) * 4;
        const field = xBody[x] * yGaussian;

        pixels[index] = 128;
        pixels[index + 1] = 128;
        pixels[index + 2] = 0;
        pixels[index + 3] = 255;

        if (field < threshold - .025) continue;

        const gx = xGrad[x] * yGaussian;
        const gy = gyScale * field;
        const gradient = Math.sqrt(gx * gx + gy * gy);
        const safe = Math.sqrt(gradient * gradient + .00000625);
        const lutIndex = Math.min(
          fieldAmpLookup.length - 1,
          Math.max(0, Math.round(clamp(field / 2.4, 0, 1) * (fieldAmpLookup.length - 1))),
        );
        const amp = fieldAmpLookup[lutIndex];
        const distance = (field - threshold) / Math.max(gradient, .003);
        const edgeT = clamp((distance - 1.7) / 3, 0, 1);
        const edgeGate = edgeT * edgeT * (3 - 2 * edgeT);
        const dx = gx / safe * amp * 12 * distortionStrength * edgeGate;
        const dyDisplacement = gy / safe * amp * 17.5 * distortionStrength * edgeGate;

        pixels[index] = Math.round(clamp(128 + dx / 64 * 255, 0, 255));
        pixels[index + 1] = Math.round(clamp(128 + dyDisplacement / 64 * 255, 0, 255));
        pixels[index + 2] = Math.round(clamp(distance / sx + .5, 0, 1) * 255);
      }
    }

    mapCtx.putImageData(map, 0, 0);
    const mapUrl = mapCanvas.toDataURL('image/png');
    vector.setAttribute('href', mapUrl);
    if (maskSurface) maskSurface.setAttribute('href', mapUrl);
    if ((bezelFrame++ & 1) === 0 || handoffProgress >= 1) renderBezel(movingS, weight, flowGain);
  }

  function renderBezel(movingS, weight, flowGain) {
    if (!bezelCtx || !bezelSurface) return;

    const scale = 1.25;
    const supportLevel = Math.max(.001, threshold - .06);
    const supportRadius = movingS * Math.sqrt(-2 * Math.log(supportLevel / 3));
    const pad = Math.max(10, supportRadius + 6);
    const x0 = Math.max(0, Math.floor(bx - pad));
    const x1 = Math.min(width, Math.ceil(cx + pad));
    const y0 = Math.max(0, Math.floor(by - pad));
    const y1 = Math.min(height, Math.ceil(by + pad));
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const cw = Math.max(1, Math.ceil(bw * scale));
    const ch = Math.max(1, Math.ceil(bh * scale));

    if (bezelCanvas.width !== cw) bezelCanvas.width = cw;
    if (bezelCanvas.height !== ch) bezelCanvas.height = ch;

    const image = bezelCtx.createImageData(cw, ch);
    const pixels = image.data;
    const movingDen = 2 * movingS * movingS;
    const invS2 = 1 / (movingS * movingS);
    const sqrt2 = Math.SQRT2;
    const bodyX = new Float32Array(cw);
    const gradX = new Float32Array(cw);

    for (let x = 0; x < cw; x++) {
      const px = x0 + (x + .5) / scale;
      const dxB = px - bx;
      const dxC = px - cx;
      const nearest = clamp(px, bx, cx);
      const dxN = px - nearest;
      const eB = Math.exp(-(dxB * dxB) / movingDen);
      const eC = Math.exp(-(dxC * dxC) / movingDen);
      const eN = 2 * Math.exp(-(dxN * dxN) / movingDen);
      bodyX[x] = flowGain * ((1 - weight) * (eB + eC) + weight * eN);
      gradX[x] = -flowGain * ((1 - weight) * (dxB * eB + dxC * eC) + weight * dxN * eN) * invS2;
    }

    for (let y = 0; y < ch; y++) {
      const py = y0 + (y + .5) / scale;
      const dy = py - by;
      const yGaussian = Math.exp(-(dy * dy) / movingDen);
      const gyScale = -dy * invS2;

      for (let x = 0; x < cw; x++) {
        const index = (y * cw + x) * 4;
        const field = bodyX[x] * yGaussian;
        if (field < threshold - .06) continue;

        const gx = gradX[x] * yGaussian;
        const gy = gyScale * field;
        const gradient = Math.sqrt(gx * gx + gy * gy);
        const safe = Math.max(gradient, .003);
        const distance = (field - threshold) / safe;
        const coverage = clamp(distance * scale + .5, 0, 1);
        if (coverage <= 0) continue;

        const nx = -gx / safe;
        const ny = -gy / safe;
        const edge = Math.exp(-(((distance - .30) / .48) ** 2));
        const soft = Math.exp(-(((distance - 1.10) / 1.05) ** 2));
        const topLeft = Math.pow(Math.max(0, (-nx - ny) / sqrt2), 11);
        const bottomRight = Math.pow(Math.max(0, (nx + ny) / sqrt2), 11);
        const base = coverage * (.014 + .055 * edge);
        const highlight = coverage * soft * (.46 * topLeft + .36 * bottomRight);
        const alpha = clamp(base + highlight, 0, .58);
        const mix = clamp((topLeft + bottomRight) * .9, 0, 1);

        pixels[index] = Math.round(205 + 38 * mix);
        pixels[index + 1] = Math.round(214 + 34 * mix);
        pixels[index + 2] = Math.round(225 + 30 * mix);
        pixels[index + 3] = Math.round(alpha * 255);
      }
    }

    bezelCtx.putImageData(image, 0, 0);
    bezelSurface.setAttribute('x', String(x0));
    bezelSurface.setAttribute('y', String(y0));
    bezelSurface.setAttribute('width', String(bw));
    bezelSurface.setAttribute('height', String(bh));
    bezelSurface.setAttribute('href', bezelCanvas.toDataURL('image/png'));
  }

  function settle() {
    if (!prepareGeometry()) return;
    const x = halfSpan();
    const baseX = width / 2;
    bx = baseX - x;
    cx = baseX + x;
    by = cy = baseY;
    syncStartupIcons();
    setFinalState();
  }

  function play() {
    if (!prepareGeometry()) return;
    setInitialState();
    running = true;
    startTime = performance.now();

    function frame(now) {
      const elapsed = Math.min(timing.total, now - startTime);
      pose(elapsed);
      render();

      if (elapsed < timing.total) {
        requestFrame(frame);
        return;
      }

      running = false;
      if (Math.round(root.host.clientWidth) !== width) settle();
      else setFinalState();
    }

    frame(startTime);
  }

  let lastWidth = 0;
  const resizeObserver = new RuntimeResizeObserver(() => {
    if (root.host.clientWidth === lastWidth) return;
    lastWidth = root.host.clientWidth;
    if (!running) settle();
  });
  resizeObserver.observe(root.host);

  if (playEntrance) play();
  else settle();

  return {
    dispose() {
      disposed = true;
      frames.forEach(id => globalThis.cancelAnimationFrame(id));
      frames.clear();
      observers.forEach(observer => observer.disconnect());
      observers.clear();
    },
  };
}
