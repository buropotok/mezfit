// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

interface TestBootRuntime {
  getLaunchStartParam?(): string | null;
}

type TestWindow = Window & typeof globalThis & {
  __MEZFIT_BOOT__?: TestBootRuntime;
};

function runBootstrapBeforeTelegramSdk(path: string): TestBootRuntime | undefined {
  window.history.replaceState({}, '', path);
  delete window.Telegram;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(parsed.scripts);
  const telegramSdkIndex = scripts.findIndex(
    (script) => script.getAttribute('src') === 'https://telegram.org/js/telegram-web-app.js',
  );

  expect(telegramSdkIndex).toBeGreaterThan(0);

  const testWindow = window as TestWindow;
  delete testWindow.__MEZFIT_BOOT__;

  for (const script of scripts.slice(0, telegramSdkIndex)) {
    const source = script.textContent?.trim();
    if (source) testWindow.eval(source);
  }

  return testWindow.__MEZFIT_BOOT__;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
  delete (window as TestWindow).__MEZFIT_BOOT__;
  delete window.Telegram;
});

describe('Telegram launch bootstrap', () => {
  it('captures a query launch parameter before Telegram SDK execution', () => {
    const startParam = `invite_${'q'.repeat(36)}`;

    const runtime = runBootstrapBeforeTelegramSdk(`/?tgWebAppStartParam=${startParam}`);

    expect(window.Telegram).toBeUndefined();
    expect(runtime?.getLaunchStartParam?.()).toBe(startParam);
  });

  it('captures a fragment launch parameter before Telegram SDK execution', () => {
    const startParam = `invite_${'h'.repeat(36)}`;

    const runtime = runBootstrapBeforeTelegramSdk(
      `/#tgWebAppStartParam=${startParam}&tgWebAppVersion=8.0`,
    );

    expect(window.Telegram).toBeUndefined();
    expect(runtime?.getLaunchStartParam?.()).toBe(startParam);
  });
});
