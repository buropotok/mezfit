// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, completeBrowserLogin, getBrowserSession, prepareBrowserLogin } from '../api';
import { BrowserTelegramLogin } from './BrowserTelegramLogin';
import { loadTelegramLoginSdk } from './telegramLoginSdk';

vi.mock('../api', async importOriginal => ({
  ...await importOriginal<typeof import('../api')>(),
  completeBrowserLogin: vi.fn(), getBrowserSession: vi.fn(), prepareBrowserLogin: vi.fn(),
}));
vi.mock('./telegramLoginSdk', () => ({ loadTelegramLoginSdk: vi.fn() }));

const challenge = { clientId: 123, nonce: 'test-nonce', expiresIn: 300 };
const identity = { telegramUserId: '123', name: 'Подтверждённый пользователь', username: '' };
let callback: ((payload: unknown) => void) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  callback = undefined;
  vi.mocked(getBrowserSession).mockResolvedValue(null);
  vi.mocked(prepareBrowserLogin).mockResolvedValue(challenge);
  vi.mocked(loadTelegramLoginSdk).mockResolvedValue({ auth: (_options, complete) => { callback = complete; } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openLogin() {
  const button = await screen.findByRole('button', { name: 'Войти через Telegram' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}

it('waits for a slow session check past the previous five-second cutoff', async () => {
  vi.useFakeTimers();
  vi.mocked(getBrowserSession).mockImplementationOnce(signal => new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(identity), 6_500);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new Error('session request aborted'));
    }, { once: true });
  }));

  render(<BrowserTelegramLogin />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
  expect(screen.getByText('Проверяем браузерную сессию…')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByText(/Подтверждённый пользователь/)).toBeTruthy();
});

it('allows retrying the session check after a transient server error', async () => {
  vi.mocked(getBrowserSession)
    .mockRejectedValueOnce(new ApiError(503, 'Запрос браузерной авторизации не выполнен'))
    .mockResolvedValueOnce(identity);

  render(<BrowserTelegramLogin />);
  expect(await screen.findByText(/HTTP 503/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }));
  expect(await screen.findByText(/Подтверждённый пользователь/)).toBeTruthy();
  expect(getBrowserSession).toHaveBeenCalledTimes(2);
  expect(prepareBrowserLogin).not.toHaveBeenCalled();
});

it('uses a popup but only displays the identity read from the server session', async () => {
  vi.mocked(completeBrowserLogin).mockResolvedValue(identity);
  render(<BrowserTelegramLogin />);
  await openLogin();
  expect(screen.getByText('Завершите вход в окне Telegram.')).toBeTruthy();
  await act(async () => callback?.({ id_token: 'token', user: { name: 'Подмена' } }));
  expect(completeBrowserLogin).toHaveBeenCalledWith('token', expect.any(AbortSignal));
  expect(await screen.findByText(/Подтверждённый пользователь/)).toBeTruthy();
  expect(screen.queryByText(/Подмена/)).toBeNull();
});

it('allows retry after a failed SDK load and after closing the popup', async () => {
  vi.mocked(loadTelegramLoginSdk).mockRejectedValueOnce(new Error('SDK offline'));
  render(<BrowserTelegramLogin />);
  fireEvent.click(await screen.findByRole('button', { name: 'Попробовать ещё раз' }));
  await openLogin();
  act(() => callback?.({ error: 'popup_closed' }));
  expect(await screen.findByRole('button', { name: 'Попробовать ещё раз' })).toBeTruthy();
  expect(completeBrowserLogin).not.toHaveBeenCalled();
});

it('shows the safe server reason and ignores callbacks from a previous attempt', async () => {
  vi.mocked(completeBrowserLogin).mockRejectedValueOnce(new ApiError(401, 'Не удалось подтвердить вход (jwks: timeout)'));
  render(<BrowserTelegramLogin />);
  await openLogin();
  const previous = callback;
  await act(async () => previous?.({ id_token: 'token' }));
  expect(await screen.findByText(/jwks: timeout/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }));
  await openLogin();
  act(() => previous?.({ id_token: 'late' }));
  expect(completeBrowserLogin).toHaveBeenCalledTimes(1);
});

it('allows a retry when the popup is blocked or never calls back', async () => {
  render(<BrowserTelegramLogin />);
  const button = await screen.findByRole('button', { name: 'Войти через Telegram' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  vi.useFakeTimers();
  fireEvent.click(button);
  act(() => { vi.advanceTimersByTime(90_000); });
  expect(screen.getByText(/разрешены ли всплывающие окна/)).toBeTruthy();
  act(() => callback?.({ id_token: 'late' }));
  expect(completeBrowserLogin).not.toHaveBeenCalled();
});

it.each([false, true])('only shows the entire rejected token in explicit diagnostic mode (%s)', async debug => {
  const originalUrl = window.location.href;
  if (debug) window.history.replaceState(null, '', '?debugTelegramToken=1');
  try {
    const token = 'example.header.signature';
    vi.mocked(completeBrowserLogin).mockRejectedValueOnce(new ApiError(401, 'Не удалось подтвердить вход'));
    render(<BrowserTelegramLogin />);
    await openLogin();
    await act(async () => callback?.({ id_token: token }));
    expect(await screen.findByText('Не удалось подтвердить вход')).toBeTruthy();
    expect(completeBrowserLogin).toHaveBeenCalledWith(token, expect.any(AbortSignal));
    if (debug) {
      expect(screen.getByDisplayValue(token)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Скрыть токен' }));
    }
    expect(screen.queryByDisplayValue(token)).toBeNull();
  } finally {
    window.history.replaceState(null, '', originalUrl);
  }
});
