import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./messagebar.css', import.meta.url), 'utf8');

describe('Konsta 5.4.0 Messagebar hosted glass', () => {
  it('keeps the native textarea and neutralizes the nested decorative glass and toolbar material', () => {
    const glass = css.split('.ui-mezfit-messagebar--bare .k-glass {')[1]?.split('}')[0] ?? '';
    for (const rule of ['background: transparent', 'box-shadow: none', '-webkit-backdrop-filter: none', 'backdrop-filter: none', 'touch-action: pan-y']) {
      expect(glass).toContain(rule);
    }
    const toolbar = css.split('.ui-mezfit-messagebar--bare .k-toolbar > :not(:last-child) {')[1]?.split('}')[0] ?? '';
    expect(toolbar).toContain('display: none');
  });
});
