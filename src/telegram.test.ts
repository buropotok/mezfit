import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectionHapticBackend,
  getTelegramLaunchStartParam,
  prepareTelegramWebApp,
  triggerTelegramSelectionHaptic,
  type TelegramWebApp,
} from './telegram';

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


describe('triggerTelegramSelectionHaptic', () => {
  it('uses a short browser vibration on Telegram Android when available', () => {
    const selectionChanged = vi.fn();
    const impactOccurred = vi.fn();
    const vibrate = vi.fn(() => true);
    const webApp = createWebApp();
    webApp.platform = 'android';
    webApp.HapticFeedback = { selectionChanged, impactOccurred };

    expect(getSelectionHapticBackend(webApp, { vibrate })).toBe('android-vibration');

    triggerTelegramSelectionHaptic(webApp, { vibrate });

    expect(vibrate).toHaveBeenCalledWith(12);
    expect(selectionChanged).not.toHaveBeenCalled();
    expect(impactOccurred).not.toHaveBeenCalled();
  });

  it('uses a light Telegram impact on non-Android clients when supported', () => {
    const selectionChanged = vi.fn();
    const impactOccurred = vi.fn();
    const webApp = createWebApp();
    webApp.platform = 'ios';
    webApp.HapticFeedback = { selectionChanged, impactOccurred };

    expect(getSelectionHapticBackend(webApp, null)).toBe('telegram-light-impact');

    triggerTelegramSelectionHaptic(webApp, null);

    expect(impactOccurred).toHaveBeenCalledWith('light');
    expect(selectionChanged).not.toHaveBeenCalled();
  });

  it('falls back to Telegram selectionChanged when impact feedback is unavailable', () => {
    const selectionChanged = vi.fn();
    const webApp = createWebApp();
    webApp.HapticFeedback = { selectionChanged };

    expect(getSelectionHapticBackend(webApp, null)).toBe('telegram-selection');

    triggerTelegramSelectionHaptic(webApp, null);

    expect(selectionChanged).toHaveBeenCalledOnce();
  });

  it('is a safe no-op when haptics are unavailable', () => {
    expect(getSelectionHapticBackend(createWebApp(), null)).toBe('none');
    expect(() => triggerTelegramSelectionHaptic(createWebApp(), null)).not.toThrow();
  });

  it('falls back to Telegram selection feedback if the primary backend throws', () => {
    const selectionChanged = vi.fn();
    const webApp = createWebApp();
    webApp.platform = 'android';
    webApp.HapticFeedback = { selectionChanged };

    expect(() => triggerTelegramSelectionHaptic(webApp, {
      vibrate: () => {
        throw new Error('vibration unavailable');
      },
    })).not.toThrow();
    expect(selectionChanged).toHaveBeenCalledOnce();
  });
});
