import { describe, expect, it, vi } from 'vitest';
import { getTelegramStartParam, prepareTelegramWebApp, type TelegramWebApp } from './telegram';

function createWebApp(disableVerticalSwipes?: () => void): TelegramWebApp {
  return {
    initData: 'test-init-data',
    colorScheme: 'light',
    ready: vi.fn(),
    expand: vi.fn(),
    disableVerticalSwipes,
  };
}

describe('prepareTelegramWebApp', () => {
  it('prepares the Mini App and disables swipe-to-collapse when supported', () => {
    const disableVerticalSwipes = vi.fn();
    const webApp = createWebApp(disableVerticalSwipes);

    prepareTelegramWebApp(webApp);

    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
    expect(disableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it('remains compatible with Telegram clients without vertical swipe control', () => {
    const webApp = createWebApp();

    expect(() => prepareTelegramWebApp(webApp)).not.toThrow();
    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
  });
});


describe('getTelegramStartParam', () => {
  it('prefers the signed start_param from initData', () => {
    const webApp = createWebApp();
    webApp.initData = 'auth_date=1&start_param=invite_signed';

    expect(getTelegramStartParam(webApp, '?tgWebAppStartParam=invite_fallback')).toBe('invite_signed');
  });

  it('falls back to Telegram tgWebAppStartParam from the query string', () => {
    const webApp = createWebApp();
    webApp.initData = 'auth_date=1';

    expect(getTelegramStartParam(webApp, '?tgWebAppStartParam=invite_fallback', '')).toBe('invite_fallback');
  });

  it('falls back to Telegram tgWebAppStartParam from the WebView hash', () => {
    const webApp = createWebApp();
    webApp.initData = 'auth_date=1';

    expect(
      getTelegramStartParam(webApp, '', '#tgWebAppData=old&tgWebAppStartParam=invite_hash'),
    ).toBe('invite_hash');
  });
});
