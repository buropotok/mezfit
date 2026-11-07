import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./message.css', import.meta.url), 'utf8');

describe('Mezfit Message focus pulse', () => {
  it('brightens only the bubble background and fades to transparent in exactly 100 ms', () => {
    const bubble = css.split('.ui-mezfit-message__focus-pulse::before {')[1]?.split('}')[0] ?? '';
    const animation = css.split('@keyframes ui-mezfit-message-focus-pulse {')[1] ?? '';
    expect(bubble).toContain('position: absolute');
    expect(bubble).toContain('border-radius: inherit');
    expect(bubble).toContain('pointer-events: none');
    expect(bubble).toContain('background: rgb(255 255 255 / 0.2)');
    expect(bubble).toContain('100ms ease-out');
    expect(animation).toContain('from { opacity: 1; }');
    expect(animation).toContain('to { opacity: 0; }');
    expect(css).not.toContain('filter: brightness');
  });
});
