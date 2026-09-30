import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectionHapticBackend,
  getTelegramLaunchStartParam,
  prepareTelegramWebApp,
  runHapticProbe,
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
  it('prefers Telegram notification success for TimePicker selection feedback', () => {
    const selectionChanged = vi.fn();
    const impactOccurred = vi.fn();
    const notificationOccurred = vi.fn();
    const webApp = createWebApp();
    webApp.HapticFeedback = { selectionChanged, impactOccurred, notificationOccurred };

    expect(getSelectionHapticBackend(webApp)).toBe('telegram-success-notification');

    triggerTelegramSelectionHaptic(webApp);

    expect(notificationOccurred).toHaveBeenCalledWith('success');
    expect(impactOccurred).not.toHaveBeenCalled();
    expect(selectionChanged).not.toHaveBeenCalled();
  });

  it('falls back to a light Telegram impact when notification feedback is unavailable', () => {
    const selectionChanged = vi.fn();
    const impactOccurred = vi.fn();
    const webApp = createWebApp();
    webApp.HapticFeedback = { selectionChanged, impactOccurred };

    expect(getSelectionHapticBackend(webApp)).toBe('telegram-light-impact');

    triggerTelegramSelectionHaptic(webApp);

    expect(impactOccurred).toHaveBeenCalledWith('light');
    expect(selectionChanged).not.toHaveBeenCalled();
  });

  it('falls back to Telegram selection feedback when notification and impact are unavailable', () => {
    const selectionChanged = vi.fn();
    const webApp = createWebApp();
    webApp.HapticFeedback = { selectionChanged };

    expect(getSelectionHapticBackend(webApp)).toBe('telegram-selection');

    triggerTelegramSelectionHaptic(webApp);

    expect(selectionChanged).toHaveBeenCalledOnce();
  });

  it('is a safe no-op when haptics are unavailable or the client throws', () => {
    expect(getSelectionHapticBackend(createWebApp())).toBe('none');
    expect(() => triggerTelegramSelectionHaptic(createWebApp())).not.toThrow();

    const webApp = createWebApp();
    webApp.HapticFeedback = {
      selectionChanged: vi.fn(),
      notificationOccurred: () => {
        throw new Error('haptics unavailable');
      },
    };

    expect(() => triggerTelegramSelectionHaptic(webApp)).not.toThrow();
  });
});

describe('runHapticProbe', () => {
  it('can invoke every Telegram haptic channel independently', () => {
    const selectionChanged = vi.fn();
    const impactOccurred = vi.fn();
    const notificationOccurred = vi.fn();
    const webApp = createWebApp();
    webApp.HapticFeedback = { selectionChanged, impactOccurred, notificationOccurred };

    expect(runHapticProbe('telegram-selection', webApp, null)).toBe('sent');
    expect(runHapticProbe('telegram-light-impact', webApp, null)).toBe('sent');
    expect(runHapticProbe('telegram-success-notification', webApp, null)).toBe('sent');

    expect(selectionChanged).toHaveBeenCalledOnce();
    expect(impactOccurred).toHaveBeenCalledWith('light');
    expect(notificationOccurred).toHaveBeenCalledWith('success');
  });

  it('reports browser vibration acceptance and rejection', () => {
    expect(runHapticProbe('browser-vibration', null, { vibrate: () => true })).toBe('sent');
    expect(runHapticProbe('browser-vibration', null, { vibrate: () => false })).toBe('rejected');
  });

  it('reports unsupported and thrown probe paths without breaking the stand', () => {
    expect(runHapticProbe('telegram-light-impact', createWebApp(), null)).toBe('unsupported');
    expect(runHapticProbe('browser-vibration', null, null)).toBe('unsupported');

    const webApp = createWebApp();
    webApp.HapticFeedback = {
      selectionChanged: () => {
        throw new Error('native failure');
      },
    };
    expect(runHapticProbe('telegram-selection', webApp, null)).toBe('error');
  });
});
