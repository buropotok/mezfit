// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paintLiquidPopoverText } from './liquidPopoverText';
afterEach(() => vi.restoreAllMocks());

describe('LiquidPopover plain-text raster handoff', () => {
  it('uses DOM positions for wrapping/newlines and paints combining text as a grapheme', () => {
    const element = document.createElement('span');
    element.textContent = 'А\nе́Б';
    let start = 0, end = 0;
    vi.spyOn(document, 'createRange').mockReturnValue({
      setStart: (_node: Node, value: number) => { start = value; },
      setEnd: (_node: Node, value: number) => { end = value; },
      getBoundingClientRect: () => ({ left: start < 2 ? 20 : 30, top: start < 2 ? 40 : 70, height: 20 }),
    } as unknown as Range);
    const fillText = vi.fn();
    const context = { fillText, measureText: () => ({ fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }) } as unknown as CanvasRenderingContext2D;
    expect(paintLiquidPopoverText(context, element, { left: 10, top: 30 })).toBe(true);
    expect(fillText.mock.calls).toEqual([['А', 10, 24], ['е́', 20, 54], ['Б', 20, 54]]);
    expect(end).toBe(element.textContent.length);
  });
  it('accepts empty text and falls back safely without DOM range geometry', () => {
    const element = document.createElement('span');
    const context = { measureText: () => ({ actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }) } as unknown as CanvasRenderingContext2D;
    expect(paintLiquidPopoverText(context, element, { left: 0, top: 0 })).toBe(true);
    element.textContent = 'Текст';
    vi.spyOn(document, 'createRange').mockReturnValue({} as Range);
    expect(paintLiquidPopoverText(context, element, { left: 0, top: 0 })).toBe(false);
  });
});
