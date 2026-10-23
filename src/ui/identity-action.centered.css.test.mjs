import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./identity-action.css', import.meta.url), 'utf8');

describe('centered Identity Card', () => {
  it('centers iconless labels inside the pill and retains the existing ellipsis', () => {
    const centered = css.match(/\.ui-identity-action--title-centered\s*\{([^}]*)\}/)?.[1];
    const title = css.match(/\.ui-identity-action--title-centered \.ui-identity-action__title\s*\{([^}]*)\}/)?.[1];
    const base = css.match(/\.ui-identity-action__title\s*\{([^}]*)\}/)?.[1];

    expect(centered).toContain('justify-content: center');
    expect(title).toContain('text-align: center');
    expect(base).toContain('overflow: hidden');
    expect(base).toContain('text-overflow: ellipsis');
  });
});
