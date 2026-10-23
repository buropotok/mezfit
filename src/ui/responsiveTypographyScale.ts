/** Responsive typography is a presentation-only multiplier over the saved presets.
 * It is scoped to the measured application shell, including 320px preview mode.
 */
export function responsiveTypographyScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const clampedWidth = Math.max(320, Math.min(406, width));
  return 0.9 + ((clampedWidth - 320) / 86) * 0.1;
}
