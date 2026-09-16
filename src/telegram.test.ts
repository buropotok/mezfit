import { describe, expect, it, vi } from 'vitest';
import { prepareTelegramWebApp, type TelegramWebApp } from './telegram';

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
