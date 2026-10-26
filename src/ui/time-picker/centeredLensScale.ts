/** Magnify around the glyph's own anchor, preserving the original iOS SVG scale contract. */
export function centeredLensScale(x: number, y: number, scale: number): string {
  return `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`;
}
