/** Scale an SVG glyph around its own anchor instead of the lens origin. */
export function centeredLensScale(x: number, y: number, scale: number): string {
  return `matrix(${scale} 0 0 ${scale} ${(1 - scale) * x} ${(1 - scale) * y})`;
}
