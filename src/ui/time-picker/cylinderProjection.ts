export const CYLINDER_HEIGHT = 240;
const RADIUS = CYLINDER_HEIGHT / 2;
const PERSPECTIVE = RADIUS * 4;

/** Project an arc-length offset onto the visible half of a cylinder.
 *  Logical row spacing remains unchanged in the native scroll container. */
export function projectCylinder(offset: number) {
  const angle = offset / RADIUS;
  if (Math.abs(angle) >= Math.PI / 2) return null;
  const cosine = Math.cos(angle);
  const depth = RADIUS * (1 - cosine);
  const perspective = PERSPECTIVE / (PERSPECTIVE + depth);
  return {
    y: RADIUS * Math.sin(angle) * perspective,
    scaleX: perspective,
    scaleY: cosine * perspective,
    opacity: cosine * cosine,
  };
}

export function visibleCylinderRows(count: number, scrollTop: number, rowHeight: number) {
  const reach = Math.ceil(Math.PI * RADIUS / (2 * rowHeight));
  const center = Math.floor(scrollTop / rowHeight);
  const start = Math.max(0, center - reach);
  const end = Math.min(count - 1, center + reach);
  const rows = [];
  for (let index = start; index <= end; index += 1) {
    const projection = projectCylinder(index * rowHeight - scrollTop);
    if (projection) rows.push({ index, ...projection });
  }
  return rows;
}

/** Resolve taps against projected centers, rather than flat invisible rows. */
export function cylinderIndexAt(count: number, scrollTop: number, rowHeight: number, y: number) {
  const rows = visibleCylinderRows(count, scrollTop, rowHeight);
  let index = Math.max(0, Math.min(count - 1, Math.round(scrollTop / rowHeight)));
  let distance = Infinity;
  for (const row of rows) {
    const next = Math.abs(row.y + RADIUS - y);
    if (next < distance) { distance = next; index = row.index; }
  }
  return index;
}
