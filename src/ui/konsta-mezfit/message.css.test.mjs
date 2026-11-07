import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./message.css', import.meta.url), 'utf8');

describe('Mezfit Message focus pulse', () => {
  it('brightens only the bubble background and fades to transparent in exactly 100 ms', () => {
    const bubble = css.split('.ui-mezfit-message__focus-pulse {')[1]?.split('}')[0] ?? '';
    const animation = css.split('@keyframes ui-mezfit-message-focus-pulse {')[1] ?? '';
    expect(bubble).toContain('100ms ease-out');
    expect(animation).toContain('from { box-shadow: inset 0 0 0 100vmax rgb(255 255 255 / 0.2); }');
    expect(animation).toContain('to { box-shadow: inset 0 0 0 100vmax rgb(255 255 255 / 0); }');
    expect(css).not.toContain('filter: brightness');
  });
});
