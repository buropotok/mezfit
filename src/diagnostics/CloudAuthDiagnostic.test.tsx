// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAuthDiagnostic } from './CloudAuthDiagnostic';
import { runCloudAuthProbe } from './cloudAuthProbe';

vi.mock('./cloudAuthProbe', () => ({ runCloudAuthProbe: vi.fn() }));
const probeMock = vi.mocked(runCloudAuthProbe);

afterEach(() => {
  cleanup();
  delete window.Telegram;
  probeMock.mockReset();
});

describe('Telegram-only cloud auth diagnostic', () => {
  it('uses the screen heading preset and separates status from the safety note', () => {
    render(<CloudAuthDiagnostic />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Проверка Dexie Cloud' });
    expect(heading.querySelector('.ui-text--large-title')).not.toBeNull();

    const status = screen.getByRole('status');
    const note = screen.getByText('Токены, ключи и Telegram initData не отображаются и не сохраняются.');
    expect(status.tagName).toBe('P');
    expect(note.closest('p')).not.toBeNull();
    expect(note.closest('p')).not.toBe(status);
  });

  it('never runs without Telegram initData', () => {
    render(<CloudAuthDiagnostic />);
    expect(screen.getByText('Запустите проверку внутри Telegram.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Проверить авторизацию' }) as HTMLButtonElement).disabled).toBe(true);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('requests a token only after a tap and displays success without exposing credentials', async () => {
    window.Telegram = {
      WebApp: {
        initData: 'signed-telegram-data',
        colorScheme: 'dark',
        ready: vi.fn(),
        expand: vi.fn(),
      },
    };
    probeMock.mockResolvedValue();
    render(<CloudAuthDiagnostic />);
    expect(probeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить авторизацию' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Успешно'));
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(probeMock).toHaveBeenCalledWith('signed-telegram-data');
    expect(screen.queryByText('signed-telegram-data')).toBeNull();
  });

  it('shows only a generic failure code, never an error message containing a token', async () => {
    window.Telegram = {
      WebApp: {
        initData: 'signed-telegram-data',
        colorScheme: 'dark',
        ready: vi.fn(),
        expand: vi.fn(),
      },
    };
    probeMock.mockRejectedValue(new Error('secret-token-value'));
    render(<CloudAuthDiagnostic />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить авторизацию' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('CLIENT_ERROR'));
    expect(screen.queryByText(/secret-token-value/)).toBeNull();
  });
});
