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
    cols = 12,
    rows = 24,
    grid: Point[] = [];
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
      grid.push({ x: compressed + (flat - compressed) * unfold, y });
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

/** A neutral optical center, with inward sampling confined to the rim. */
export function paintLiquidMap(
  context: CanvasRenderingContext2D,
  loops: Point[][],
  path: string,
) {
  const bounds = contourBounds(loops),
    pad = 40,
    step = 2;
  const x = Math.floor(bounds.left - pad),
    y = Math.floor(bounds.top - pad);
  const width = Math.ceil(bounds.right - x + pad),
    height = Math.ceil(bounds.bottom - y + pad);
  const mw = Math.ceil(width / step),
    mh = Math.ceil(height / step),
    sx = width / mw,
    sy = height / mh;
  context.canvas.width = mw;
  context.canvas.height = mh;
  context.setTransform(1 / sx, 0, 0, 1 / sy, -x / sx, -y / sy);
  context.fillStyle = 'white';
  context.fill(new Path2D(path));
  context.resetTransform();
  const mask = context.getImageData(0, 0, mw, mh).data,
    depth = new Float32Array(mw * mh),
    diagonal = Math.SQRT2;
  for (let i = 0; i < depth.length; i++)
    depth[i] = mask[i * 4 + 3] > 127 ? 100000 : 0;
  for (let row = 1; row < mh - 1; row++)
    for (let col = 1; col < mw - 1; col++) {
      const i = row * mw + col;
      if (depth[i])
        depth[i] = Math.min(
          depth[i],
          depth[i - 1] + 1,
          depth[i - mw] + 1,
          depth[i - mw - 1] + diagonal,
          depth[i - mw + 1] + diagonal,
        );
    }
  let maxDepth = 1;
  for (let row = mh - 2; row > 0; row--)
    for (let col = mw - 2; col > 0; col--) {
      const i = row * mw + col;
      if (depth[i]) {
        depth[i] = Math.min(
          depth[i],
          depth[i + 1] + 1,
          depth[i + mw] + 1,
          depth[i + mw + 1] + diagonal,
          depth[i + mw - 1] + diagonal,
        );
        maxDepth = Math.max(maxDepth, depth[i]);
      }
    }
  // Smooth the distance field before its gradient, avoiding medial seams.
  let soft = depth;
  for (let pass = 0; pass < 2; pass++) {
    const temp = new Float32Array(depth.length),
      out = new Float32Array(depth.length);
    for (let row = 0; row < mh; row++) {
      const offset = row * mw;
      let sum =
        4 * soft[offset] +
        soft[offset + 1] +
        soft[offset + 2] +
        soft[offset + 3];
      for (let col = 0; col < mw; col++) {
        temp[offset + col] = sum / 7;
        sum +=
          soft[offset + Math.min(col + 4, mw - 1)] -
          soft[offset + Math.max(col - 3, 0)];
      }
    }
    for (let col = 0; col < mw; col++) {
      let sum =
        4 * temp[col] +
        temp[mw + col] +
        temp[2 * mw + col] +
        temp[3 * mw + col];
      for (let row = 0; row < mh; row++) {
        out[row * mw + col] = sum / 7;
        sum +=
          temp[Math.min(row + 4, mh - 1) * mw + col] -
          temp[Math.max(row - 3, 0) * mw + col];
      }
    }
    soft = out;
  }
  const edgeBand = Math.min(32, maxDepth * Math.min(sx, sy) * 0.45),
    map = context.createImageData(mw, mh);
  for (let i = 0; i < depth.length; i++) {
    map.data[i * 4] = 128;
    map.data[i * 4 + 1] = 128;
    map.data[i * 4 + 2] = 128;
    map.data[i * 4 + 3] = 255;
  }
  for (let row = 2; row < mh - 2; row++)
    for (let col = 2; col < mw - 2; col++) {
      const i = row * mw + col,
        distance = depth[i] * Math.min(sx, sy);
      if (!depth[i] || distance >= edgeBand) continue;
      const gx = (soft[i + 2] - soft[i - 2]) / 4,
        gy = (soft[i + mw * 2] - soft[i - mw * 2]) / 4;
      const safe = Math.sqrt(gx * gx + gy * gy + 0.25),
        amplitude = edgeBand * 0.4 * smoother(1 - distance / edgeBand);
      map.data[i * 4] = Math.round(
        clamp(128 + (((gx / safe) * amplitude) / 64) * 255, 0, 255),
      );
      map.data[i * 4 + 1] = Math.round(
        clamp(128 + (((gy / safe) * amplitude) / 64) * 255, 0, 255),
      );
    }
  context.putImageData(map, 0, 0);
  return { x, y, width, height, href: context.canvas.toDataURL() };
}
