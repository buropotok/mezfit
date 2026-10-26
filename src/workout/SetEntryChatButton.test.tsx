// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { SetEntryChatButton } from './SetEntryChatButton';

afterEach(cleanup);

describe('SetEntry chat action', () => {
  it('keeps the action visible but unavailable until chat is connected', () => {
    render(<KonstaProvider theme="ios" dark><SetEntryChatButton /></KonstaProvider>);
    expect(screen.getByRole('button', { name: 'Открыть чат' }).hasAttribute('disabled')).toBe(true);
  });

  it('delegates an enabled chat action to its owner', () => {
    const open = vi.fn();
    render(<KonstaProvider theme="ios" dark><SetEntryChatButton onOpenChat={open} /></KonstaProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('blocks chat navigation while the set is being saved', () => {
    const open = vi.fn();
    render(<KonstaProvider theme="ios" dark><SetEntryChatButton onOpenChat={open} saving /></KonstaProvider>);
    const button = screen.getByRole('button', { name: 'Открыть чат' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
  });
});
