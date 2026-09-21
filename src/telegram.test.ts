import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTelegramLaunchStartParam, prepareTelegramWebApp, type TelegramWebApp } from './telegram';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('getTelegramLaunchStartParam', () => {
  it('prefers the pre-SDK launch capture over later URL and initData values', () => {
    const capturedStartParam = `invite_${'c'.repeat(36)}`;
    vi.stubGlobal('window', {
      __MEZFIT_BOOT__: {
        getLaunchStartParam: () => capturedStartParam,
      },
    });
    const webApp = createWebApp();
    webApp.initDataUnsafe = { start_param: `invite_${'a'.repeat(36)}` };

    expect(getTelegramLaunchStartParam(
      webApp,
      `?tgWebAppStartParam=invite_${'b'.repeat(36)}`,
      '',
    )).toBe(capturedStartParam);
  });

  it('prefers the current URL launch parameter over stale initData launch context', () => {
    const webApp = createWebApp();
    webApp.initDataUnsafe = { start_param: `invite_${'a'.repeat(36)}` };

    expect(getTelegramLaunchStartParam(
      webApp,
      `?tgWebAppStartParam=invite_${'b'.repeat(36)}`,
    )).toBe(`invite_${'b'.repeat(36)}`);
  });

  it('falls back to Telegram initDataUnsafe when the URL has no launch parameter', () => {
    const webApp = createWebApp();
    webApp.initDataUnsafe = { start_param: `invite_${'a'.repeat(36)}` };

    expect(getTelegramLaunchStartParam(webApp, '', '')).toBe(`invite_${'a'.repeat(36)}`);
  });

  it('reads the launch parameter from the Telegram URL fragment', () => {
    const webApp = createWebApp();

    expect(getTelegramLaunchStartParam(
      webApp,
      '',
      `#tgWebAppStartParam=invite_${'d'.repeat(36)}&tgWebAppVersion=8.0`,
    )).toBe(`invite_${'d'.repeat(36)}`);
  });
});
