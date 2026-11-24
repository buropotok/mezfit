// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

interface TestBootRuntime {
  getLaunchStartParam?(): string | null;
  telegramSdkReady?: Promise<void>;
  mark(stage: string): void;
  finish(): void;
}

type TestWindow = Window & typeof globalThis & {
  __MEZFIT_BOOT__?: TestBootRuntime;
};

function runBootstrapBeforeTelegramSdk(path: string): TestBootRuntime | undefined {
  window.history.replaceState({}, '', path);
  delete window.Telegram;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(parsed.head.querySelectorAll('script'));
  expect(scripts.some(script => script.getAttribute('src') === 'https://telegram.org/js/telegram-web-app.js'))
    .toBe(false);

  const testWindow = window as TestWindow;
  delete testWindow.__MEZFIT_BOOT__;

  for (const script of scripts) {
    if (script.hasAttribute('src')) continue;
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
  document.getElementById('mezfit-boot-diagnostics')?.remove();
  document.querySelectorAll('script[src="https://telegram.org/js/telegram-web-app.js"]')
    .forEach(script => script.remove());
});

describe('Telegram launch bootstrap', () => {
  it('captures a query launch parameter before Telegram SDK execution', () => {
    const startParam = `invite_${'q'.repeat(36)}`;

    const runtime = runBootstrapBeforeTelegramSdk(`/?tgWebAppStartParam=${startParam}`);

    expect(window.Telegram).toBeUndefined();
    expect(runtime?.getLaunchStartParam?.()).toBe(startParam);
    expect(runtime?.telegramSdkReady).toBeUndefined();
    expect(document.querySelector('script[src="https://telegram.org/js/telegram-web-app.js"]')).toBeNull();
  });

  it('skips the WebApp SDK on a normal browser entry', () => {
    const runtime = runBootstrapBeforeTelegramSdk('/');
    expect(runtime?.telegramSdkReady).toBeUndefined();
    expect(document.querySelector('script[src="https://telegram.org/js/telegram-web-app.js"]')).toBeNull();
  });

  it('loads the SDK for Telegram launch parameters in the URL fragment and gates startup', async () => {
    const runtime = runBootstrapBeforeTelegramSdk(
      '/#tgWebAppPlatform=android&tgWebAppVersion=8.0&tgWebAppData=user%3D1',
    );
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://telegram.org/js/telegram-web-app.js"]',
    );
    expect(script).not.toBeNull();
    expect(runtime?.telegramSdkReady).toBeDefined();

    let settled = false;
    void runtime?.telegramSdkReady?.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    script?.dispatchEvent(new Event('load'));
    await runtime?.telegramSdkReady;
    expect(settled).toBe(true);
  });

  it('loads the SDK for Telegram launch parameters in the query string', async () => {
    const runtime = runBootstrapBeforeTelegramSdk('/?tgWebAppPlatform=ios&tgWebAppVersion=8.0');
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://telegram.org/js/telegram-web-app.js"]',
    );
    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event('load'));
    await runtime?.telegramSdkReady;
  });

  it('releases the startup gate if Telegram SDK loading fails', async () => {
    const runtime = runBootstrapBeforeTelegramSdk('/#tgWebAppData=auth_date%3D1');
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://telegram.org/js/telegram-web-app.js"]',
    );
    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event('error'));
    await runtime?.telegramSdkReady;
    expect(document.getElementById('mezfit-boot-diagnostics')?.textContent)
      .toContain('Последний этап: telegram-sdk-error');
  });

  it('keeps diagnostics visible until React confirms its first mount', () => {
    const runtime = runBootstrapBeforeTelegramSdk('/');
    runtime?.mark('theme-applied');

    vi.advanceTimersByTime(8000);
    expect(document.getElementById('mezfit-boot-diagnostics')?.textContent)
      .toContain('Последний этап: theme-applied');

    runtime?.finish();
    expect(document.getElementById('mezfit-boot-diagnostics')).toBeNull();
  });

  it('clears the watchdog panel after a delayed React mount', () => {
    const runtime = runBootstrapBeforeTelegramSdk('/');
    runtime?.mark('theme-request-start');

    vi.advanceTimersByTime(8000);
    expect(document.getElementById('mezfit-boot-diagnostics')?.textContent)
      .toContain('Последний этап: theme-request-start');

    runtime?.finish();
    runtime?.mark('theme-applied');
    expect(document.getElementById('mezfit-boot-diagnostics')).toBeNull();
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
