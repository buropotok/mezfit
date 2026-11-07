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
  it('never draws a square outline around the target row', () => {
    expect(css).not.toContain('.discussion-message-target[data-highlighted]');
    expect(css).not.toContain('outline-offset: -2px');
  });
  it('reserves 24px corners for the growing glass input and no black sync strip', () => {
    const sheet = readFileSync(new URL('./DiscussionSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain('className="discussion-composer__field" {...material} shape={{ radius: 24 }}');
    expect(sheet).not.toContain('className="discussion-composer__field" {...material} shape="capsule"');
    const context = css.split('.discussion-composer-context {')[1]?.split('}')[0] ?? '';
    expect(context).toContain('background: transparent');
    const identity = css.split('.discussion-thread__identity {')[1]?.split('}')[0] ?? '';
    expect(identity).toContain('flex-direction: column');
  });

  it('keeps the composer wrapper transparent so only the three children own glass', () => {
    const block = css.match(/\.discussion-composer\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const declaration of ['position: absolute', 'display: flex', 'background: transparent', 'gap: 8px']) expect(block).toContain(declaration);
    expect(css).not.toContain('.discussion-composer-surface');
  });

});
