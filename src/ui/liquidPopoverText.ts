/** Rasterize the primitive's own plain-text node at browser-measured positions.
 * DOM Range owns wrapping (including long words/newlines), not a second canvas
 * line-break algorithm. Use the same semantic font as the live HTML handoff.
 */
export function paintLiquidPopoverText(
  context: CanvasRenderingContext2D,
  element: HTMLElement,
  bounds: Pick<DOMRect, 'left' | 'top'>,
): boolean {
  const node = element.firstChild;
  if (!node) return true;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? '';
  const style = getComputedStyle(element);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.fillStyle = style.color;
  context.textBaseline = 'alphabetic';
  context.globalAlpha = 1;
  const metrics = context.measureText('Mg');
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  const range = element.ownerDocument.createRange();
  if (typeof range.getBoundingClientRect !== 'function') return false;
  let offset = 0;
  const characters = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
    : Array.from(text);
  // Measuring whole graphemes keeps emoji and combining characters intact. Each position
  // includes the browser's letter spacing, white space and wrapping decisions.
  for (const character of characters) {
    range.setStart(node, offset);
    offset += character.length;
    range.setEnd(node, offset);
    const rect = range.getBoundingClientRect();
    if (/[\r\n]/.test(character) || !rect.height) continue;
    const baseline = rect.top - bounds.top + rect.height / 2 + (ascent - descent) / 2;
    context.fillText(character, rect.left - bounds.left, baseline);
  }
  return true;
}
