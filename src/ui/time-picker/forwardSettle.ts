/** Find the aligned row in the direction of the last native scroll movement.
 *  The final movement is at most one row and never reverses a wheel flick. */
export function forwardSettledIndex(
  scrollTop: number,
  rowHeight: number,
  direction: -1 | 0 | 1,
  count: number,
): number {
  const row = scrollTop / rowHeight;
  // Ignore fractional-pixel drift when the browser already stopped on a row.
  const tolerance = 0.001;
  const index = direction > 0 ? Math.ceil(row - tolerance)
    : direction < 0 ? Math.floor(row + tolerance)
      : Math.round(row);
  return Math.max(0, Math.min(count - 1, index));
}
