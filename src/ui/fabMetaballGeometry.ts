/** CSS-pixel geometry from the approved FAB lab; no displacement/lens layer. */
export const FAB_METABALL = Object.freeze({
  duration: 450, delay: 0.22, distance: 68, reach: 24,
  width: 100, height: 44, phaseRecoil: 10, dayRecoil: 5.5, dropLead: 0.65,
});

// Reserve the complete motion, including the day capsule's recoil, in CSS pixels.
export const FAB_METABALL_STAGE_WIDTH = 2 * FAB_METABALL.width + FAB_METABALL.distance
  - FAB_METABALL.height + FAB_METABALL.phaseRecoil + FAB_METABALL.dayRecoil;

export type FabLayout = { width: number; sourceSize: number };
type Point = { x: number; y: number };
type Capsule = Point & { width: number; height: number; tailHeight: number };
export type FabGeometry = { day: Capsule; phase: Capsule; base: Point };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const smoothFab = (x: number) => { const p = clamp(x); return p * p * (3 - 2 * p); };

export function fabGeometry(time: number, layout: FabLayout, shift = 0, dayShift = 0): FabGeometry {
  const c = FAB_METABALL;
  const width = c.width;
  const separation = (width + c.distance - c.height) * smoothFab(time / 0.86);
  const initial = layout.sourceSize * 0.2;
  const exit = (layout.sourceSize + initial) / 2;
  const full = width - initial * 0.6;
  const growth = clamp((separation - exit) / (full - exit));
  const phaseGrowth = smoothFab((growth - c.delay) / (1 - c.delay));
  const phaseWidth = layout.sourceSize + (width - layout.sourceSize) * phaseGrowth;
  const phaseHeight = layout.sourceSize + (c.height - layout.sourceSize) * phaseGrowth;
  const exponent = 1 + c.dropLead * 2;
  const height = initial + (c.height - initial) * (1 - (1 - growth) ** exponent);
  const tailHeight = initial + (c.height - initial) * growth ** exponent;
  let dayWidth = initial + (width - initial) * growth;
  if (growth > 0 && growth < 1) {
    dayWidth = Math.min(width, Math.max(dayWidth, 2 * separation - phaseWidth + initial * 0.6 * growth));
  }
  dayWidth = Math.max(dayWidth, height);
  const base = { x: layout.width - layout.sourceSize / 2, y: layout.sourceSize / 2 };
  const phaseX = base.x - (phaseWidth - layout.sourceSize) / 2;
  return {
    base,
    phase: { x: phaseX - shift, y: base.y, width: phaseWidth, height: phaseHeight, tailHeight: phaseHeight },
    day: { x: phaseX - c.phaseRecoil * smoothFab(time / 0.2) - separation + dayShift, y: base.y, width: dayWidth, height, tailHeight },
  };
}

function capsuleField(x: number, y: number, c: Capsule) {
  const leftRadius = c.height / 2, rightRadius = c.tailHeight / 2;
  const left = c.x - c.width / 2 + leftRadius;
  const right = c.x + c.width / 2 - rightRadius;
  const length = right - left;
  let distance: number;
  if (length < 0.00001) distance = Math.hypot(x - c.x, y - c.y) - Math.max(leftRadius, rightRadius);
  else {
    const slope = (rightRadius - leftRadius) / length;
    const safeSlope = Math.max(-0.99999, Math.min(0.99999, slope));
    const closest = Math.max(left, Math.min(right, x + safeSlope * Math.abs(y - c.y) / Math.sqrt(1 - safeSlope * safeSlope)));
    distance = Math.hypot(x - closest, y - c.y) - leftRadius - slope * (closest - left);
  }
  const q = clamp(0.5 - distance / (2 * FAB_METABALL.reach));
  return q ** 3 * (q * (q * 6 - 15) + 10);
}

function field(g: FabGeometry, x: number, y: number) {
  const mix = smoothFab((Math.abs(g.day.x - g.phase.x) + g.day.width / 2 - g.phase.width / 2) / g.day.height);
  const a = capsuleField(x, y, g.day), b = capsuleField(x, y, g.phase);
  return Math.max(a, b) + mix * Math.min(a, b) - 0.500001;
}

export function fabJoined(g: FabGeometry) {
  const left = g.day.x + g.day.width / 2, right = g.phase.x - g.phase.width / 2;
  if (right <= left) return true;
  for (let i = 0; i <= 64; i++) if (field(g, left + (right - left) * i / 64, g.base.y) < 0) return false;
  return true;
}

export function fabRupture(layout: FabLayout) {
  let lo = 0, hi = 1;
  const joined = (t: number) => fabJoined(fabGeometry(t, layout, FAB_METABALL.phaseRecoil * smoothFab(t / 0.2)));
  for (let i = 1; i <= 120; i++) if (!joined(i / 120)) { lo = (i - 1) / 120; hi = i / 120; break; }
  for (let i = 0; i < 16; i++) { const middle = (lo + hi) / 2; if (joined(middle)) lo = middle; else hi = middle; }
  return hi;
}

export function fabFrame(time: number, layout: FabLayout, rupture: number) {
  const dt = Math.max(0, (time - rupture) * FAB_METABALL.duration / 1000);
  const finish = 1 - smoothFab((time - 0.96) / 0.04);
  const phaseShift = time < rupture ? FAB_METABALL.phaseRecoil * smoothFab(time / 0.2)
    : FAB_METABALL.phaseRecoil * Math.exp(-20 * dt) * Math.cos(38 * dt) * finish;
  const dayShift = time < rupture ? 0 : -FAB_METABALL.dayRecoil * (dt / 0.045) * Math.exp(1 - dt / 0.045) * finish;
  return fabGeometry(time, layout, phaseShift, dayShift);
}

function capsulePath(c: Capsule) {
  const r = c.height / 2, left = c.x - c.width / 2, right = c.x + c.width / 2;
  return `M${left + r},${c.y - r}H${right - r}A${r},${r} 0 0 1 ${right - r},${c.y + r}H${left + r}A${r},${r} 0 0 1 ${left + r},${c.y - r}Z`;
}

/** Triangulated implicit contour; compact support preserves distant capsule edges. */
export function fabContour(g: FabGeometry) {
  const { day, phase } = g;
  if (Math.abs(day.x - phase.x) + day.width / 2 <= phase.width / 2 && day.height <= phase.height) return capsulePath(phase);
  if (phase.x - phase.width / 2 - day.x - day.width / 2 >= FAB_METABALL.reach * 2 && day.height === day.tailHeight) return capsulePath(day) + capsulePath(phase);
  const step = 1.5, padding = FAB_METABALL.reach + 3;
  const minX = Math.floor((Math.min(day.x - day.width / 2, phase.x - phase.width / 2) - padding) / step) * step;
  const minY = Math.floor((g.base.y - Math.max(day.height, phase.height) / 2 - padding) / step) * step;
  const nx = Math.ceil((Math.max(day.x + day.width / 2, phase.x + phase.width / 2) + padding - minX) / step) + 1;
  const ny = Math.ceil((g.base.y + Math.max(day.height, phase.height) / 2 + padding - minY) / step) + 1;
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = field(g, minX + i * step, minY + j * step);
  const vertices = new Map<string, Point>(), links = new Map<string, string[]>();
  const crossing = (i: number, j: number) => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (!vertices.has(key)) {
      const p = values[i] / (values[i] - values[j]);
      vertices.set(key, { x: minX + (i % nx + (j % nx - i % nx) * p) * step, y: minY + (Math.floor(i / nx) + (Math.floor(j / nx) - Math.floor(i / nx)) * p) * step });
    }
    return key;
  };
  const triangle = (ids: [number, number, number]) => {
    const edges: string[] = [];
    for (let k = 0; k < 3; k++) { const i = ids[k], j = ids[(k + 1) % 3]; if ((values[i] > 0) !== (values[j] > 0)) edges.push(crossing(i, j)); }
    if (edges.length === 2) {
      const [a, b] = edges;
      links.set(a, [...(links.get(a) ?? []), b]); links.set(b, [...(links.get(b) ?? []), a]);
    }
  };
  for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const i = y * nx + x; triangle([i, i + 1, i + nx + 1]); triangle([i, i + nx + 1, i + nx]);
  }
  const visited = new Set<string>(); let path = '';
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    let at = start, previous: string | undefined;
    const points: Point[] = [];
    for (let n = 0; n <= links.size; n++) {
      if (visited.has(at)) {
        if (at === start && points.length > 2) path += `M${points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('L')}Z`;
        break;
      }
      visited.add(at);
      const point = vertices.get(at); if (!point) break;
      points.push(point);
      const next = links.get(at)?.find(key => key !== previous); if (!next) break;
      previous = at; at = next;
    }
  }
  return path;
}
