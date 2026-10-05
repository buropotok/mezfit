import { resolveGlassRadius } from './glassMaterial';
export type Point = { x: number; y: number };
export type LiquidRect = Point & { w: number; h: number };
export type LiquidMotionOptions = {
  duration: number;
  sourceMorph: number;
  tail: number;
  ovalArea: number;
  exponent: number;
  growthDelay: number;
  curvature: number;
  smoothing: number;
};
export const LIQUID_POPOVER_DEFAULTS: Readonly<LiquidMotionOptions> =
  Object.freeze({
    duration: 0.5,
    sourceMorph: 0.28,
    tail: 35,
    ovalArea: 0.65,
    exponent: 2.5,
    growthDelay: 0.25,
    curvature: 0.92,
    smoothing: 1.3,
  });
type Geometry = {
  head: Point;
  a: number;
  b: number;
  n: number;
  nodes: Point[];
  fill: number;
  exitLength: number;
  externalLength: number;
  joinGain: number;
  k: number;
  r: number;
};
export function createLiquidMotion(
  source: LiquidRect,
  rect: LiquidRect,
  options: LiquidMotionOptions = LIQUID_POPOVER_DEFAULTS,
) {
  const R = 13.5,
    SPRING_SECONDS = 0.45;
  let route: Point[] = [],
    lengths: number[] = [],
    total = 1,
    target = { x: 0, y: 0, a: 0, b: 0, n: 2 };
  const clamp = (x: number, a: number, b: number) =>
      Math.max(a, Math.min(b, x)),
    smooth = (x: number) => {
      x = clamp(x, 0, 1);
      return x * x * (3 - 2 * x);
    };
  function indexRoute() {
    lengths = [0];
    for (let i = 1; i < route.length; i++)
      lengths.push(
        lengths[i - 1] +
          Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y),
      );
    total = lengths[lengths.length - 1] || 1;
  }
  function logGamma(z: number) {
    const c = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < c.length; i++) x += c[i] / (z + i + 1);
    const t = z + 7.5;
    return (
      0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
    );
  }
  function areaCoefficient(n: number) {
    return 4 * Math.exp(2 * logGamma(1 + 1 / n) - logGamma(1 + 2 / n));
  }
  function superNorm(x: number, y: number, n: number) {
    if (n === 2) return Math.hypot(x, y);
    return Math.pow(Math.pow(Math.abs(x), n) + Math.pow(Math.abs(y), n), 1 / n);
  }
  function superPoint(angle: number, a: number, b: number, n: number) {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      r = 1 / superNorm(c, s, n);
    return { x: a * c * r, y: b * s * r };
  }
  function rebuild() {
    const ratio = options.ovalArea,
      n = options.exponent,
      scale = Math.sqrt((ratio * 4) / areaCoefficient(n));
    target = {
      x: rect.x,
      y: rect.y + rect.h / 2 + 10 - (rect.h / 2) * scale,
      a: (rect.w / 2) * scale,
      b: (rect.h / 2) * scale,
      n,
    };
    // Same aspect ratio as the rectangle; superellipse area is exactly ratio*w*h.
    const side = target.x >= source.x ? 1 : -1;
    const startPoint = {
      x: source.x + side * Math.max(0, (source.w - source.h) / 2),
      y: source.y,
    };
    const sx = startPoint.x,
      sy = startPoint.y;
    const vx = target.x >= sx ? 1 : -1,
      vy = target.y >= sy ? 1 : -1;
    const radius =
      Math.min(Math.abs(target.x - sx) * 0.95, Math.abs(target.y - sy) * 0.8) *
      options.curvature;
    route = [];
    function line(a: Point, b: Point) {
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        route.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      }
    }
    if (Math.abs(target.x - sx) < 30 || Math.abs(target.y - sy) < 30) {
      // Near alignment still needs horizontal departure and vertical arrival.
      const a = { x: sx + vx * 12, y: sy },
        b = { x: target.x, y: target.y - vy * 12 },
        handle = 18 + 42 * options.curvature;
      line({ x: sx, y: sy }, a);
      for (let i = 1; i <= 80; i++) {
        const u = i / 80,
          v = 1 - u;
        route.push({
          x:
            v * v * v * a.x +
            3 * v * v * u * (a.x + vx * handle) +
            3 * v * u * u * b.x +
            u * u * u * b.x,
          y:
            v * v * v * a.y +
            3 * v * v * u * a.y +
            3 * v * u * u * (b.y - vy * handle) +
            u * u * u * b.y,
        });
      }
      line(b, { x: target.x, y: target.y });
      indexRoute();
      return;
    }
    const start = { x: sx, y: sy },
      bend = { x: target.x - vx * radius, y: sy };
    line(start, bend);
    if (radius > 0) {
      for (let i = 1; i <= 40; i++) {
        const a = ((i / 40) * Math.PI) / 2;
        route.push({
          x: bend.x + vx * radius * Math.sin(a),
          y: sy + vy * radius * (1 - Math.cos(a)),
        });
      }
    }
    line({ x: target.x, y: sy + vy * radius }, { x: target.x, y: target.y });
    route = route.filter(
      (p, i, a) =>
        !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.0001,
    );
    indexRoute();
  }
  function at(distance: number) {
    if (distance < 0) {
      const a = route[0],
        b = route[1],
        d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        x: a.x + ((b.x - a.x) / d) * distance,
        y: a.y + ((b.y - a.y) / d) * distance,
      };
    }
    distance = Math.min(distance, total);
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < distance) i++;
    const u = (distance - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1),
      a = route[i - 1],
      b = route[i];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  function geometry(t: number) {
    const shrink = smoother((t * options.duration) / options.sourceMorph),
      baseRadius = source.h / 2 + (R - source.h / 2) * shrink,
      baseTail =
        source.w - source.h + (options.tail - (source.w - source.h)) * shrink;
    t = clamp(t / 0.8, 0, 1);
    const movement = smooth(t),
      s = movement * total,
      head = at(s),
      delay = options.growthDelay,
      fill = smooth((t - delay) / (1 - delay));
    const offset = {
      x: target.x - route[route.length - 1].x,
      y: target.y - route[route.length - 1].y,
    };
    head.x += offset.x * movement;
    head.y += offset.y * movement;
    const a = baseRadius + (target.a - baseRadius) * fill,
      b = baseRadius + (target.b - baseRadius) * fill,
      n = 2 + (target.n - 2) * fill;
    // Find the first exit from the growing ellipse along the same curved spine.
    // Only the OUTSIDE part is consumed. The portion inside the bulb must not
    // count as the visible tail, otherwise the tail vanishes before filling ends.
    const rawHead = at(s),
      r =
        baseRadius +
        (Math.min(R, target.a * 0.8, target.b * 0.8) - baseRadius) * fill;
    const rim = Array.from({ length: 36 }, (_, i) => ({
      x: r * Math.cos((i * Math.PI) / 18),
      y: r * Math.sin((i * Math.PI) / 18),
    }));
    // Track the rounded cap's first contact with the ellipse, not its center.
    const q = (d: number) => {
      const p = at(s - d);
      let value = 0;
      for (const v of rim)
        value = Math.max(
          value,
          superNorm(
            (p.x - rawHead.x + v.x) / a,
            (p.y - rawHead.y + v.y) / b,
            n,
          ),
        );
      return value;
    };
    const stride = Math.max(2, Math.min(a, b) / 8);
    let lo = 0,
      hi = stride;
    const limit = total + 4 * Math.max(a, b) + 100;
    while (q(hi) < 1 && hi < limit) {
      lo = hi;
      hi += stride;
    }
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (q(mid) < 1) lo = mid;
      else hi = mid;
    }
    const exitLength = (lo + hi) / 2,
      externalLength = baseTail * Math.pow(1 - fill, 0.85);
    const tailLength = exitLength + externalLength,
      nodes = [];
    for (let i = 0; i <= 16; i++) {
      const p = at(s - (tailLength * i) / 16);
      p.x += offset.x * movement;
      p.y += offset.y * movement;
      nodes.push(p);
    }
    return {
      head,
      a,
      b,
      n,
      nodes,
      fill,
      exitLength,
      externalLength,
      joinGain: options.smoothing,
      k: 12 * Math.sin(Math.PI * fill),
      r,
    };
  }
  function parts(x: number, y: number, g: Geometry) {
    const dx = x - g.head.x,
      dy = y - g.head.y,
      bulb = (superNorm(dx / g.a, dy / g.b, g.n) - 1) * Math.min(g.a, g.b);
    let squared = Infinity;
    for (let i = 1; i < g.nodes.length; i++) {
      const a = g.nodes[i - 1],
        b = g.nodes[i],
        vx = b.x - a.x,
        vy = b.y - a.y,
        u = clamp(
          ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1),
          0,
          1,
        ),
        px = x - a.x - vx * u,
        py = y - a.y - vy * u;
      squared = Math.min(squared, px * px + py * py);
    }
    return { bulb, rope: Math.sqrt(squared) - g.r };
  }
  function field(x: number, y: number, g: Geometry) {
    const { bulb, rope } = parts(x, y, g);
    if (g.fill >= 1) return bulb;
    // A small constant blend forms the baseline contour. The user's control
    // never changes this field, so it cannot inflate local shoulders.
    const k = g.k;
    if (k < 0.01) return Math.min(bulb, rope);
    const h = Math.max(k - Math.abs(bulb - rope), 0) / k;
    return Math.min(bulb, rope) - h * h * k * 0.25;
  }
  const smoother = (x: number) => {
    x = clamp(x, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  };
  function resampleClosed(ps: Point[]) {
    const sums = [0],
      n = ps.length;
    for (let i = 0; i < n; i++)
      sums.push(
        sums[i] +
          Math.hypot(ps[(i + 1) % n].x - ps[i].x, ps[(i + 1) % n].y - ps[i].y),
      );
    const length = sums[n],
      count = Math.max(24, Math.ceil(length / 1.5)),
      spacing = length / count,
      out = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * spacing;
      while (j < n - 1 && sums[j + 1] < s) j++;
      const u = (s - sums[j]) / (sums[j + 1] - sums[j] || 1),
        a = ps[j],
        b = ps[(j + 1) % n];
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    return { points: out, spacing };
  }
  function fairJoin(loops: Point[][], g: Geometry) {
    if (g.joinGain <= 0 || g.fill <= 0 || g.fill >= 1) return loops;
    return loops.map((loop) => {
      const { points: ps, spacing } = resampleClosed(loop),
        n = ps.length;
      const labels = ps.map((p) => {
        const s = parts(p.x, p.y, g);
        return s.bulb <= s.rope;
      });
      const joins: number[] = [];
      for (let i = 0; i < n; i++)
        if (labels[i] !== labels[(i + 1) % n]) joins.push(i + 0.5);
      if (!joins.length) return loop;
      // Smooth coordinates along arc length, over a wider section of BOTH
      // sides of the join. Positive weights cannot create outward overshoots.
      const reach = (10 + g.joinGain * 12) * Math.sin(Math.PI * g.fill),
        sigma = reach * 0.42;
      const kernelRadius = Math.min(
        Math.floor(n / 4),
        Math.ceil((sigma * 3) / spacing),
      );
      if (kernelRadius < 1) return loop;
      const weights: number[] = [];
      let weightSum = 0;
      for (let j = -kernelRadius; j <= kernelRadius; j++) {
        const w = Math.exp(-0.5 * Math.pow((j * spacing) / sigma, 2));
        weights.push(w);
        weightSum += w;
      }
      const tip = g.nodes[g.nodes.length - 1];
      return ps.map((p, i) => {
        let distance = Infinity;
        for (const j of joins) {
          const d = Math.abs(i - j);
          distance = Math.min(distance, Math.min(d, n - d) * spacing);
        }
        const cap = smoother(
          (Math.hypot(p.x - tip.x, p.y - tip.y) - g.r * 0.9) / (g.r * 1.5),
        );
        const influence = (1 - smoother(distance / (reach * 1.8))) * cap;
        if (influence < 1e-5) return p;
        let x = 0,
          y = 0;
        for (let j = -kernelRadius; j <= kernelRadius; j++) {
          const q = ps[(i + j + n) % n],
            w = weights[j + kernelRadius];
          x += q.x * w;
          y += q.y * w;
        }
        return {
          x: p.x + (x / weightSum - p.x) * influence,
          y: p.y + (y / weightSum - p.y) * influence,
        };
      });
    });
  }
  function contours(g: Geometry) {
    const step = 2.5,
      pad = 24;
    let minX = g.head.x - g.a - pad,
      maxX = g.head.x + g.a + pad,
      minY = g.head.y - g.b - pad,
      maxY = g.head.y + g.b + pad;
    for (const p of g.nodes) {
      minX = Math.min(minX, p.x - R - 20);
      maxX = Math.max(maxX, p.x + R + 20);
      minY = Math.min(minY, p.y - R - 20);
      maxY = Math.max(maxY, p.y + R + 20);
    }
    const nx = Math.ceil((maxX - minX) / step),
      ny = Math.ceil((maxY - minY) / step),
      values = new Float32Array((nx + 1) * (ny + 1));
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        values[y * (nx + 1) + x] = field(minX + x * step, minY + y * step, g);
    const edges: string[][] = [],
      vertices = new Map<string, Point>(),
      adj = new Map<string, string[]>();
    function cross(x: number, y: number, edge: number, v: number[]) {
      const ends = [
          [0, 1],
          [1, 2],
          [3, 2],
          [0, 3],
        ][edge],
        coords = [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ],
        a = coords[ends[0]],
        b = coords[ends[1]],
        key =
          edge === 0
            ? 'h' + x + ',' + y
            : edge === 2
              ? 'h' + x + ',' + (y + 1)
              : edge === 1
                ? 'v' + (x + 1) + ',' + y
                : 'v' + x + ',' + y;
      if (!vertices.has(key)) {
        const f = v[ends[0]] / (v[ends[0]] - v[ends[1]]);
        vertices.set(key, {
          x: minX + (a[0] + (b[0] - a[0]) * f) * step,
          y: minY + (a[1] + (b[1] - a[1]) * f) * step,
        });
      }
      return key;
    }
    function connect(a: string, b: string) {
      edges.push([a, b]);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)?.push(b);
      adj.get(b)?.push(a);
    }
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const j = y * (nx + 1) + x,
          v = [
            values[j],
            values[j + 1],
            values[j + nx + 2],
            values[j + nx + 1],
          ],
          c = [];
        for (let e = 0; e < 4; e++) {
          const pair = [
            [0, 1],
            [1, 2],
            [3, 2],
            [0, 3],
          ][e];
          if (v[pair[0]] < 0 !== v[pair[1]] < 0) c.push(cross(x, y, e, v));
        }
        if (c.length === 2) connect(c[0], c[1]);
        else if (c.length === 4) {
          connect(c[0], c[1]);
          connect(c[2], c[3]);
        }
      }
    const used = new Set<string>(),
      loops: Point[][] = [];
    for (const [start] of edges) {
      if (used.has(start)) continue;
      let cur: string | undefined = start,
        prev: string | undefined,
        loop: Point[] = [];
      while (cur && !used.has(cur)) {
        used.add(cur);
        const vertex = vertices.get(cur);
        if (vertex) loop.push(vertex);
        const list: string[] = adj.get(cur) || [],
          next: string | undefined = list.find((v) => v !== prev);
        prev = cur;
        cur = next;
        if (!cur) break;
      }
      if (loop.length > 4) loops.push(loop);
    }
    return loops;
  }
  function pulledShell(g: Geometry) {
    // A short tail stops being a separate capsule. It becomes a broad
    // displacement of the ellipse's own skin in the direction of the spine.
    const amount =
      smooth((3 * g.r - g.externalLength) / (2.25 * g.r)) *
      smooth(g.joinGain / 2);
    if (amount < 0.001 || g.fill <= 0 || g.fill >= 1) return null;
    const tip = g.nodes[g.nodes.length - 1],
      vx = tip.x - g.head.x,
      vy = tip.y - g.head.y,
      L = Math.hypot(vx, vy) || 1,
      dx = vx / L,
      dy = vy / L;
    const theta = Math.atan2(vy / g.b, vx / g.a),
      width = 1.05 + 0.12 * g.joinGain;
    const lift = g.externalLength,
      ps = [];
    for (let i = 0; i < 300; i++) {
      const angle = (i / 300) * Math.PI * 2,
        p = superPoint(angle, g.a, g.b, g.n),
        ex = p.x,
        ey = p.y;
      const delta = Math.atan2(
          Math.sin(angle - theta),
          Math.cos(angle - theta),
        ),
        u = Math.abs(delta) / width;
      // Compact C2 support spans most of the upper half of the shell.
      const weight = u < 1 ? Math.pow(1 - u * u, 3) : 0;
      const pulled = {
        x: g.head.x + ex + dx * lift * weight,
        y: g.head.y + ey + dy * lift * weight,
      };
      if (amount > 0.999) {
        ps.push(pulled);
        continue;
      }
      const radius = Math.hypot(ex, ey),
        rx = ex / radius,
        ry = ey / radius;
      let lo = 0,
        hi = Math.max(g.a, g.b) + g.exitLength + g.externalLength + g.r + 30;
      for (let j = 0; j < 15; j++) {
        const mid = (lo + hi) / 2;
        if (field(g.head.x + rx * mid, g.head.y + ry * mid, g) < 0) lo = mid;
        else hi = mid;
      }
      const r = (lo + hi) / 2,
        base = { x: g.head.x + rx * r, y: g.head.y + ry * r };
      ps.push({
        x: base.x + (pulled.x - base.x) * amount,
        y: base.y + (pulled.y - base.y) * amount,
      });
    }
    return [ps];
  }
  function shellContour(g: Geometry) {
    return pulledShell(g) || fairJoin(contours(g), g);
  }
  function cornerRadius() {
    return resolveGlassRadius(rect.w, rect.h);
  }
  function roundedDistance(x: number, y: number) {
    const r = cornerRadius(),
      qx = Math.abs(x) - rect.w / 2 + r,
      qy = Math.abs(y) - rect.h / 2 + r;
    return (
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
      Math.min(Math.max(qx, qy), 0) -
      r
    );
  }
  function morphContour(t: number) {
    const u = smoother((t - 0.8) / 0.2),
      ps = [];
    for (let i = 0; i < 360; i++) {
      const angle = (i / 360) * Math.PI * 2,
        dx = Math.cos(angle),
        dy = Math.sin(angle);
      const er = 1 / superNorm(dx / target.a, dy / target.b, target.n);
      let lo = 0,
        hi = Math.hypot(rect.w, rect.h);
      for (let j = 0; j < 25; j++) {
        const mid = (lo + hi) / 2;
        if (roundedDistance(dx * mid, dy * mid) > 0) hi = mid;
        else lo = mid;
      }
      const rr = (lo + hi) / 2;
      ps.push({
        x: target.x + dx * er + (rect.x + dx * rr - target.x - dx * er) * u,
        y: target.y + dy * er + (rect.y + dy * rr - target.y - dy * er) * u,
      });
    }
    return [ps];
  }
  function mainTime(t: number) {
    return t * (1 + SPRING_SECONDS / options.duration);
  }
  function springStretch(seconds: number) {
    if (seconds <= 0 || seconds >= SPRING_SECONDS) return 0;
    const fade = 1 - smoother((seconds - 0.28) / (0.45 - 0.28));
    return (
      0.045 *
      Math.exp(-7 * seconds) *
      Math.sin(2 * Math.PI * 4.5 * seconds) *
      smooth(seconds / 0.04) *
      fade
    );
  }
  function animationContour(t: number) {
    const time = mainTime(t);
    if (time >= 1) {
      const stretch = springStretch((time - 1) * options.duration),
        sy = 1 + stretch,
        sx = 1 / sy;
      return morphContour(1).map((loop) =>
        loop.map((p) => ({
          x: rect.x + (p.x - rect.x) * sx,
          y: rect.y + (p.y - rect.y) * sy,
        })),
      );
    }
    if (time >= 0.8) return morphContour(time);
    return shellContour(geometry(time));
  }
  function contourPath(loops: Point[][]) {
    return loops
      .map((ps) => {
        const n = ps.length,
          f = (x: number) => x.toFixed(3);
        let d =
          'M' +
          f((ps[n - 1].x + ps[0].x) / 2) +
          ' ' +
          f((ps[n - 1].y + ps[0].y) / 2);
        for (let i = 0; i < n; i++) {
          const p = ps[i],
            q = ps[(i + 1) % n];
          d +=
            ' Q' +
            f(p.x) +
            ' ' +
            f(p.y) +
            ' ' +
            f((p.x + q.x) / 2) +
            ' ' +
            f((p.y + q.y) / 2);
        }
        return d + ' Z';
      })
      .join(' ');
  }

  rebuild();
  return {
    contour: animationContour,
    path: contourPath,
    time: mainTime,
    geometry,
    spring: springStretch,
    totalSeconds: options.duration + SPRING_SECONDS,
  };
}
