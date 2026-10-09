import { describe, expect, it } from 'vitest';
import { resolveLiquidPopoverRenderMode } from './liquidPopoverRenderMode';

describe('LiquidPopover rendering compatibility', () => {
  it('uses Canvas clipping automatically on iPhone and iPad', () => {
    expect(resolveLiquidPopoverRenderMode('auto', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe('canvas');
    expect(resolveLiquidPopoverRenderMode('auto', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe('canvas');
    expect(resolveLiquidPopoverRenderMode('auto', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      maxTouchPoints: 5,
    })).toBe('canvas');
  });

  it('prefers Telegram iOS platform when the user agent is not identifiable', () => {
    expect(resolveLiquidPopoverRenderMode('auto', {
      userAgent: 'Custom WebView',
      telegramPlatform: 'ios',
    })).toBe('canvas');
  });

  it('preserves SVG clipping on Android, desktop and without browser info', () => {
    expect(resolveLiquidPopoverRenderMode('auto', { userAgent: 'Android Chrome', telegramPlatform: 'android' })).toBe('svg');
    expect(resolveLiquidPopoverRenderMode('auto', { userAgent: 'Macintosh', maxTouchPoints: 0 })).toBe('svg');
    expect(resolveLiquidPopoverRenderMode('auto', null)).toBe('svg');
  });

  it('respects both explicit demo modes on any platform', () => {
    const iPhone = { userAgent: 'iPhone', telegramPlatform: 'ios' };
    expect(resolveLiquidPopoverRenderMode('svg', iPhone)).toBe('svg');
    expect(resolveLiquidPopoverRenderMode('canvas', { userAgent: 'Android' })).toBe('canvas');
  });
});
