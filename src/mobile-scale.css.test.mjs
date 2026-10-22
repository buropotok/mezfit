import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const typographySettings = readFileSync(new URL('./typographySettings.ts', import.meta.url), 'utf8');
const entryHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rootRule = appCss.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';

describe('mobile CSS sizing baseline', () => {
  it('uses a fixed 16px rem baseline for app and UI kit dimensions', () => {
    expect(rootRule).toMatch(/(?:^|\n)\s*font-size:\s*16px;/);
  });

  it('prevents browser text inflation without locking the viewport width', () => {
    expect(rootRule).toContain('-webkit-text-size-adjust: none;');
    expect(rootRule).toContain('text-size-adjust: none;');
    expect(entryHtml).toContain('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(entryHtml).not.toMatch(/user-scalable\s*=\s*no/i);
  });

  it('preserves pixel-based semantic typography settings for app-owned text', () => {
    expect(typographySettings).toContain('`${value.size}px`');
    expect(typographySettings).toContain('`${value.lineHeight}px`');
  });
});
