import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./discussion-sheet.css', import.meta.url), 'utf8');
describe('discussion-owned composition', () => {
  it('keeps a non-visible round source in the bubble center and one-line quote ellipsis without Konsta selectors', () => {
    const source = css.match(/\.discussion-menu-source\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['left: 50%', 'top: 50%', 'width: 4px', 'height: 4px', 'border-radius: 50%', 'opacity: 0', 'pointer-events: none']) expect(source).toContain(declaration);
    const quote = css.match(/\.discussion-quote__text\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden']) expect(quote).toContain(declaration);
    expect(css).not.toMatch(/\.k-|font-size:|font-weight:|line-height:/);
  });
});
