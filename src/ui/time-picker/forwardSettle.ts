/** Align the cell whose center is closest to the horizontal selection line.
 *  An exact midpoint selects the higher index; finite boundaries are clamped. */
export function nearestSettledIndex(
  scrollTop: number,
  rowHeight: number,
  count: number,
): number {
  return Math.max(0, Math.min(count - 1, Math.round(scrollTop / rowHeight)));
}
