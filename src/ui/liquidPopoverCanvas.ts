import type { LiquidRect, Point } from './liquidPopoverGeometry';

export const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
export const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
export const smoother = (value: number) => {
  const t = clamp(value);
  return t ** 3 * (t * (t * 6 - 15) + 10);
};

export function contourBounds(loops: Point[][]) {
  const points = loops.flat();
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function triangle(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  a: Point,
  b: Point,
  d: Point,
  A: Point,
  B: Point,
  D: Point,
) {
  const determinant = (b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y);
  if (Math.abs(determinant) < 1e-8) return;
  const m11 =
    ((B.x - A.x) * (d.y - a.y) - (D.x - A.x) * (b.y - a.y)) / determinant;
  const m21 =
    ((B.y - A.y) * (d.y - a.y) - (D.y - A.y) * (b.y - a.y)) / determinant;
  const m12 =
    ((D.x - A.x) * (b.x - a.x) - (B.x - A.x) * (d.x - a.x)) / determinant;
  const m22 =
    ((D.y - A.y) * (b.x - a.x) - (B.y - A.y) * (d.x - a.x)) / determinant;
  const center = { x: (A.x + B.x + D.x) / 3, y: (A.y + B.y + D.y) / 3 };
  const expand = (point: Point) => {
    const dx = point.x - center.x,
      dy = point.y - center.y,
      length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * 0.4,
      y: point.y + (dy / length) * 0.4,
    };
  };
  const aa = expand(A),
    bb = expand(B),
    dd = expand(D);
  context.save();
  context.beginPath();
  context.moveTo(aa.x, aa.y);
  context.lineTo(bb.x, bb.y);
  context.lineTo(dd.x, dd.y);
  context.closePath();
  context.clip();
  context.setTransform(
    m11,
    m21,
    m12,
    m22,
    A.x - m11 * a.x - m12 * a.y,
    A.y - m21 * a.x - m22 * a.y,
  );
  const x = Math.max(0, Math.min(a.x, b.x, d.x) - 1),
    y = Math.max(0, Math.min(a.y, b.y, d.y) - 1);
  const width = Math.min(source.width, Math.max(a.x, b.x, d.x) + 1) - x;
  const height = Math.min(source.height, Math.max(a.y, b.y, d.y) + 1) - y;
  context.drawImage(source, x, y, width, height, x, y, width, height);
  context.restore();
}

/** One pixel per CSS pixel while blurred; the settled surface uses live HTML. */
export function paintLiquidMesh(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  loops: Point[][],
  time: number,
  rect: LiquidRect,
  stretch: number,
  strength = 0,
) {
  context.resetTransform();
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  const unfold = smoother((time - 0.8) / 0.2);
  if (unfold === 1) {
    context.save();
    context.translate(rect.x, rect.y);
    context.scale(1 / (1 + stretch), 1 + stretch);
    context.drawImage(source, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    context.restore();
    return;
  }
  const bounds = contourBounds(loops),
    points = loops[0],
    cols = 6,
    rows = 8,
    grid: Point[] = [];
  const edgeBand = Math.min(32, Math.min(
    bounds.right - bounds.left, bounds.bottom - bounds.top,
  ) * 0.225);
  for (let j = 0; j <= rows; j++) {
    const y = bounds.top + ((bounds.bottom - bounds.top) * j) / rows;
    const sampleY = clamp(y, bounds.top + 0.0001, bounds.bottom - 0.0001),
      hits: number[] = [];
    for (let k = 0; k < points.length; k++) {
      const a = points[k],
        b = points[(k + 1) % points.length];
      if (
        (a.y <= sampleY && b.y > sampleY) ||
        (b.y <= sampleY && a.y > sampleY)
      )
        hits.push(a.x + ((b.x - a.x) * (sampleY - a.y)) / (b.y - a.y));
    }
    const left = hits.length
      ? Math.min(...hits)
      : (bounds.left + bounds.right) / 2;
    const right = hits.length ? Math.max(...hits) : left;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols,
        compressed = left + (right - left) * u,
        flat = bounds.left + (bounds.right - bounds.left) * u;
      const point = { x: compressed + (flat - compressed) * unfold, y };
      const offset = strength > 0
        ? sampleLiquidRim(points, point, edgeBand)
        : { x: 0, y: 0 };
      grid.push({
        x: point.x - offset.x * strength,
        y: point.y - offset.y * strength,
      });
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = { x: (i / cols) * source.width, y: (j / rows) * source.height };
      const b = { x: ((i + 1) / cols) * source.width, y: a.y };
      const d = { x: a.x, y: ((j + 1) / rows) * source.height },
        e = { x: b.x, y: d.y };
      const k = j * (cols + 1) + i,
        A = grid[k],
        B = grid[k + 1],
        D = grid[k + cols + 1],
        E = grid[k + cols + 2];
      triangle(context, source, a, b, d, A, B, D);
      triangle(context, source, b, e, d, B, E, D);
    }
}

/** Sample only mesh vertices, rather than rasterizing a distance field.
 * Interior distances point inward; outside and the flat center stay neutral.
 * Work is bounded by contour segments × mesh vertices, with no pixel readback.
 */
export function sampleLiquidRim(points: readonly Point[], point: Point, edgeBand: number): Point {
  let inside = false, nearestX = 0, nearestY = 0, distanceSquared = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared) : 0;
    const x = point.x - (a.x + t * dx), y = point.y - (a.y + t * dy);
    const squared = x * x + y * y;
    if (squared < distanceSquared) {
      distanceSquared = squared;
      nearestX = x;
      nearestY = y;
    }
  }
  const distance = Math.sqrt(distanceSquared);
  if (!inside || !edgeBand || distance >= edgeBand) return { x: 0, y: 0 };
  const amplitude = edgeBand * 0.4 * smoother(1 - distance / edgeBand);
  const safe = Math.sqrt(distanceSquared + 0.25);
  return { x: nearestX / safe * amplitude, y: nearestY / safe * amplitude };
}
