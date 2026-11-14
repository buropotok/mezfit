// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMezfitChatActivation } from '../api';
import { openMezfitBotChat } from '../telegram';
import { BotStartScreen } from './BotStartScreen';

vi.mock('../api', () => ({ getMezfitChatActivation: vi.fn() }));
vi.mock('../telegram', () => ({ openMezfitBotChat: vi.fn() }));

const check = vi.mocked(getMezfitChatActivation);
const open = vi.mocked(openMezfitBotChat);
const onActivated = vi.fn();
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue(false);
});
afterEach(() => {
  cleanup();
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
});

describe('mandatory Mezfit chat activation', () => {
  it('keeps access locked until the signed chat check confirms activation', async () => {
    render(<BotStartScreen initData="signed" onActivated={onActivated} />);

    expect(screen.getByRole('heading', { name: 'Активируйте Mezfit' })).toBeTruthy();
    expect(screen.getByText('Чтобы получать сообщения от тренера и уведомления о тренировках, откройте чат Mezfit и нажмите «Старт».')).toBeTruthy();
    expect(screen.queryByText(/Продолжить в Mezfit|пропустить/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Проверить активацию' })).toBeTruthy());
    expect(onActivated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат Mezfit' }));
    expect(open).toHaveBeenCalledOnce();
    expect(onActivated).not.toHaveBeenCalled();

    check.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить активацию' }));
    await waitFor(() => expect(onActivated).toHaveBeenCalledOnce());
    expect(check).toHaveBeenCalledWith('signed');
  });

  it('automatically checks on returning from the Telegram chat', async () => {
    let visible = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    render(<BotStartScreen initData="signed" onActivated={onActivated} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Проверить активацию' })).toBeTruthy());

    check.mockResolvedValue(true);
    act(() => {
      visible = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      visible = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(onActivated).toHaveBeenCalledOnce());
  });

  it('does not unlock the interface on a Telegram API failure', async () => {
    check.mockRejectedValueOnce(new Error('offline'));
    render(<BotStartScreen initData="signed" onActivated={onActivated} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onActivated).not.toHaveBeenCalled();
    check.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить активацию' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(onActivated).not.toHaveBeenCalled();
  });
});
