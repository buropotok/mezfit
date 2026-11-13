// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, FocusEventHandler, HTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTelegramInviteShare } from '../telegram';
import { CoachInviteDialog } from './CoachInviteDialog';

vi.mock('../telegram', () => ({ requestTelegramInviteShare: vi.fn() }));
vi.mock('../ui', () => ({
  MezfitDialog: ({ opened, title, content, buttons, children }: {
    opened: boolean; title: string; content: ReactNode; buttons: ReactNode; children: ReactNode;
  }) => opened ? <div role="dialog" aria-label={title}>{content}{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
  Text: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}));
vi.mock('konsta/react', () => ({
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListInput: ({ label, inputId, value, readOnly, onFocus }: {
    label: ReactNode; inputId: string; value: string; readOnly?: boolean;
    onFocus?: FocusEventHandler<HTMLInputElement>;
  }) => <div>{label}<input id={inputId} value={value} readOnly={readOnly} onFocus={onFocus} /></div>,
}));

const URL = 'https://t.me/mezfit_bot?startapp=invite_example';

beforeEach(() => {
  vi.mocked(requestTelegramInviteShare).mockReset();
});

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function stubLegacyCopy(succeeds: boolean) {
  const execCommand = vi.fn().mockReturnValue(succeeds);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  return execCommand;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
});

describe('CoachInviteDialog', () => {
  it('opens Telegram sharing with the existing invitation and keeps it available', () => {
    const onClose = vi.fn();
    vi.mocked(requestTelegramInviteShare).mockReturnValue(true);
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в Telegram' }));

    expect(requestTelegramInviteShare).toHaveBeenCalledExactlyOnceWith(URL);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the selectable invitation when native sharing is unavailable', () => {
    vi.mocked(requestTelegramInviteShare).mockReturnValue(false);
    render(<CoachInviteDialog url={URL} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить в Telegram' }));

    expect(screen.getByRole('alert').textContent).toContain('Не удалось открыть');
    const input = screen.getByRole('textbox', { name: 'Ссылка-приглашение' }) as HTMLInputElement;
    expect(input.value).toBe(URL);
    expect(input.readOnly).toBe(true);
    const select = vi.spyOn(input, 'select');
    fireEvent.focus(input);
    expect(select).toHaveBeenCalledOnce();
  });

  it('shows the same manual fallback when clipboard access fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CoachInviteDialog url={URL} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Не удалось скопировать'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
    expect((screen.getByRole('textbox', { name: 'Ссылка-приглашение' }) as HTMLInputElement).value).toBe(URL);
  });

  it('copies selected invite text when Clipboard API rejects the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = stubLegacyCopy(true);
    execCommand.mockImplementation(() => {
      const selected = document.activeElement as HTMLTextAreaElement;
      expect(selected.value).toBe(URL);
      expect(selected.selectionStart).toBe(0);
      expect(selected.selectionEnd).toBe(URL.length);
      return true;
    });
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('uses the selected-text fallback when Clipboard API is not available', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = stubLegacyCopy(true);
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
  });

  it('keeps the URL available when legacy copying throws', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = stubLegacyCopy(false);
    execCommand.mockImplementation(() => { throw new Error('Copy denied'); });
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ссылка-приглашение' })).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('lets the user retry copying the visible text with a fresh click', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = stubLegacyCopy(false);
    execCommand.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ссылка-приглашение' })).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Скопировать текст' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать текст' }));

    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the selectable URL available if both copy methods fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = stubLegacyCopy(false);
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать текст' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать текст' }));

    const input = screen.getByRole('textbox', { name: 'Ссылка-приглашение' }) as HTMLInputElement;
    expect(input.value).toBe(URL);
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Выделите ссылку');
    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only after successful clipboard copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
  });

  it('does not close a dismissed dialog after clipboard resolves', async () => {
    let finishCopy: (() => void) | undefined;
    const writeText = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onClose = vi.fn();
    const view = render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    view.unmount();
    await act(async () => { finishCopy?.(); });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close a newer invitation when an older copy finishes late', async () => {
    let finishCopy: (() => void) | undefined;
    const writeText = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onClose = vi.fn();
    const view = render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    view.rerender(<CoachInviteDialog url="https://t.me/mezfit_bot?startapp=invite_new" onClose={onClose} />);
    await act(async () => { finishCopy?.(); });

    expect(onClose).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
  });
});
