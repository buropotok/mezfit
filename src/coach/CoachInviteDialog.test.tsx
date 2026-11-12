import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import type { FocusEventHandler, HTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTelegramInviteShare } from '../telegram';
import { CoachInviteDialog } from './CoachInviteDialog';

vi.mock('../telegram', () => ({ requestTelegramInviteShare: vi.fn() }));
vi.mock('../ui', () => ({
  MezfitDialog: ({ opened, title, content, buttons, children }: {
    opened: boolean; title: string; content: ReactNode; buttons: ReactNode; children: ReactNode;
  }) => opened ? <div role="dialog" aria-label={title}>{content}{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button type="button" {...props}>{children}</button>,
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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('closes only after successful clipboard copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onClose = vi.fn();
    render(<CoachInviteDialog url={URL} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(URL);
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
