import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./prototype.css', import.meta.url), 'utf8');

describe('liquid glass tabs startup bezel suppression', () => {
  it('suppresses both built-in GlassSurface bezel layers while startup owns the bezel', () => {
    const startupRule = css.match(
      /#iconLayer\[startup\] \.optical-toolbar-pane\.ui-glass-surface::before,[\s\S]*?\{ opacity:0; \}/,
    )?.[0];

    expect(startupRule).toContain('.ui-glass-surface::before');
    expect(startupRule).toContain('.ui-glass-surface::after');
  });
});
