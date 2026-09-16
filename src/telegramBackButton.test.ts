import { describe, expect, it, vi } from 'vitest';
import { bindTelegramBackButton, type TelegramBackButton, type TelegramWebApp } from './telegram';

function createWebApp(backButton: TelegramBackButton): TelegramWebApp {
  return {
    initData: 'telegram-init',
    colorScheme: 'dark',
    ready: vi.fn(),
    expand: vi.fn(),
    BackButton: backButton,
  };
}

describe('bindTelegramBackButton', () => {
  it('shows, subscribes, then removes the active back handler', () => {
    const backButton: TelegramBackButton = {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    };
    const onBack = vi.fn();

    const cleanup = bindTelegramBackButton(createWebApp(backButton), true, onBack);

    expect(backButton.show).toHaveBeenCalledTimes(1);
    expect(backButton.onClick).toHaveBeenCalledWith(onBack);

    cleanup();

    expect(backButton.offClick).toHaveBeenCalledWith(onBack);
    expect(backButton.hide).toHaveBeenCalledTimes(1);
  });

  it('keeps the host back button hidden when there is no nested navigation context', () => {
    const backButton: TelegramBackButton = {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    };

    const cleanup = bindTelegramBackButton(createWebApp(backButton), false, vi.fn());

    expect(backButton.hide).toHaveBeenCalledTimes(1);
    expect(backButton.show).not.toHaveBeenCalled();
    expect(backButton.onClick).not.toHaveBeenCalled();

    cleanup();
    expect(backButton.offClick).not.toHaveBeenCalled();
  });
});
