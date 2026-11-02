// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramHomeScreenStatus, TelegramWebApp } from '../telegram';
import { HomeScreenInstallToast } from './HomeScreenInstallToast';

vi.mock('konsta/react', () => ({
  Toast: ({ opened, children, button }: { opened: boolean; children: ReactNode; button: ReactNode }) => (
    opened ? <div role="status">{children}{button}</div> : null
  ),
  Button: ({
    children, rounded: _rounded, clear: _clear, small: _small, inline: _inline, ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    rounded?: boolean;
    clear?: boolean;
    small?: boolean;
    inline?: boolean;
  }) => <button {...props}>{children}</button>,
}));

function mockTelegram(status: TelegramHomeScreenStatus) {
  let addedHandler: (() => void) | undefined;
  const checkHomeScreenStatus = vi.fn((callback?: (value: TelegramHomeScreenStatus) => void) => {
    callback?.(status);
  });
  const addToHomeScreen = vi.fn();
  const onEvent = vi.fn((_event: 'homeScreenAdded', handler: () => void) => {
    addedHandler = handler;
  });
  const offEvent = vi.fn();
  const webApp: TelegramWebApp = {
    initData: 'test-init',
    colorScheme: 'dark',
    ready: vi.fn(),
    expand: vi.fn(),
    checkHomeScreenStatus,
    addToHomeScreen,
    onEvent,
    offEvent,
  };
  window.Telegram = { WebApp: webApp };
  return { checkHomeScreenStatus, addToHomeScreen, onEvent, offEvent, fireAdded: () => addedHandler?.() };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.Telegram;
  vi.useRealTimers();
});

describe('HomeScreenInstallToast', () => {
  it('offers installation when the shortcut is missed and calls Telegram on a user tap', () => {
    const telegram = mockTelegram('missed');
    render(<HomeScreenInstallToast />);

    expect(screen.getByRole('status').textContent).toContain('MezFit под рукой');
    expect(telegram.checkHomeScreenStatus).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(telegram.addToHomeScreen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['added', 'unsupported'] as const)('never offers installation for %s', (status) => {
    const telegram = mockTelegram(status);
    render(<HomeScreenInstallToast />);
    expect(telegram.checkHomeScreenStatus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers unknown only until the reminder is dismissed on this device', () => {
    mockTelegram('unknown');
    const first = render(<HomeScreenInstallToast />);

    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть предложение' }));
    expect(screen.queryByRole('status')).toBeNull();

    first.unmount();
    render(<HomeScreenInstallToast />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still offers missed after a previous unknown reminder was dismissed', () => {
    mockTelegram('unknown');
    const first = render(<HomeScreenInstallToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть предложение' }));
    first.unmount();

    mockTelegram('missed');
    render(<HomeScreenInstallToast />);
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeTruthy();
  });

  it('closes on the Telegram success event and releases the listener on unmount', () => {
    const telegram = mockTelegram('missed');
    const app = render(<HomeScreenInstallToast />);
    expect(telegram.onEvent).toHaveBeenCalledWith('homeScreenAdded', expect.any(Function));

    act(() => telegram.fireAdded());
    expect(screen.queryByRole('status')).toBeNull();

    app.unmount();
    expect(telegram.offEvent).toHaveBeenCalledWith('homeScreenAdded', expect.any(Function));
  });

  it('ignores a status callback delivered after unmount', () => {
    let callback: ((value: TelegramHomeScreenStatus) => void) | undefined;
    const telegram = mockTelegram('missed');
    const webApp = window.Telegram!.WebApp;
    webApp.checkHomeScreenStatus = vi.fn((listener?: (value: TelegramHomeScreenStatus) => void) => { callback = listener; });
    const app = render(<HomeScreenInstallToast />);
    expect(telegram.onEvent).toHaveBeenCalledOnce();

    app.unmount();
    act(() => callback?.('missed'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores a stale missed status after Telegram confirms installation', () => {
    const telegram = mockTelegram('missed');
    let respond: ((value: TelegramHomeScreenStatus) => void) | undefined;
    window.Telegram!.WebApp.checkHomeScreenStatus = vi.fn(
      (listener?: (value: TelegramHomeScreenStatus) => void) => { respond = listener; },
    );
    render(<HomeScreenInstallToast />);

    act(() => telegram.fireAdded());
    act(() => respond?.('missed'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not appear when Telegram does not support the shortcut API', () => {
    mockTelegram('missed');
    delete window.Telegram!.WebApp.checkHomeScreenStatus;
    render(<HomeScreenInstallToast />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses after ten seconds and records a handled unknown reminder', () => {
    vi.useFakeTimers();
    mockTelegram('unknown');
    const first = render(<HomeScreenInstallToast />);

    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('status')).toBeNull();

    first.unmount();
    render(<HomeScreenInstallToast />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
