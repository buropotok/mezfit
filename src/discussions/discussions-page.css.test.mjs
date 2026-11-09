import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./discussions-page.css', import.meta.url), 'utf8');
const block = selector => css.split(`${selector} {`)[1]?.split('}')[0] ?? '';

describe('discussion inbox mobile composition', () => {
  it('packs the filters and list at the top even when the page has spare height', () => {
    expect(block('.discussion-inbox')).toContain('align-content: start');
    expect(block('.discussion-inbox__filter-block')).toContain('align-content: start');
    expect(block('.discussion-inbox__filter-block')).toContain('gap: var(--ui-space-2)');
    expect(block('.discussion-inbox')).toContain('gap: var(--ui-space-3)');
    expect(css).not.toMatch(/flex-grow|space-between|min-height|margin-top/);
  });

  it('lets date controls wrap and text shrink without styling UIkit internals', () => {
    expect(block('.discussion-inbox__filters')).toContain('flex-wrap: wrap');
    expect(block('.discussion-inbox__client-filter')).toContain('minmax(0, 1fr)');
    expect(block('.discussion-inbox__ellipsis')).toContain('text-overflow: ellipsis');
    expect(css).not.toMatch(/\.k-|\.ui-|font-size:|font-weight:|line-height:/);
  });
});
