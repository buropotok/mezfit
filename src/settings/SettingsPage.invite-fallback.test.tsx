// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const DEMO_URL = 'https://example.com/mezfit/demo-invite';
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
});

function openManualFallback() {
  render(<SettingsPage onNavigationContextChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
  const module = screen.getByRole('region', { name: 'Ручное копирование приглашения' });
  expect(within(module).getByText(/на вымышленной ссылке/)).toBeTruthy();
  fireEvent.click(within(module).getByRole('button', { name: 'Показать третий фоллбек' }));
  return screen.getByRole('alertdialog', { name: 'Пригласить клиента' });
}

describe('Settings → Modules invite fallback preview', () => {
  it('shows the actual selectable fallback without creating a real invitation', () => {
    const dialog = openManualFallback();
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;

    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(DEMO_URL);
    expect(within(dialog).getByRole('button', { name: 'Скопировать текст' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Отправить в Telegram' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Копировать ссылку' })).toBeNull();

    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(DEMO_URL.length);
  });

  it('copies the demo URL with the real selection fallback and closes the preview', () => {
    const execCommand = vi.fn().mockImplementation((command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement;
      expect(command).toBe('copy');
      expect(selected.value).toBe(DEMO_URL);
      expect(selected.selectionStart).toBe(0);
      expect(selected.selectionEnd).toBe(DEMO_URL.length);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const dialog = openManualFallback();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать текст' }));

    expect(execCommand).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog', { name: 'Пригласить клиента' })).toBeNull();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('preserves manual selection when WebView copying is unavailable', () => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true, value: vi.fn().mockReturnValue(false),
    });
    const dialog = openManualFallback();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать текст' }));

    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(DEMO_URL);
    expect(within(dialog).getByRole('alert').textContent).toContain('Выделите ссылку ниже');
    expect(within(dialog).getByRole('button', { name: 'Скопировать текст' })).toBeTruthy();
  });
});
