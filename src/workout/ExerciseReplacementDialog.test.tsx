// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExerciseReplacementDialog } from './ExerciseReplacementDialog';

vi.mock('../ui', () => ({
  MezfitDialog: ({ opened, title, buttons, children }: {
    opened?: boolean; title?: ReactNode; buttons?: ReactNode; children?: ReactNode;
  }) => opened ? <div role="dialog" aria-label={String(title)}>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
afterEach(cleanup);

it('offers preserve/discard/cancel when tracking types match', () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  const { rerender } = render(<ExerciseReplacementDialog opened compatible
    onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog', { name: 'Сохранить введённые данные?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Да' }));
  expect(onConfirm).toHaveBeenLastCalledWith(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Нет' }));
  expect(onConfirm).toHaveBeenLastCalledWith(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  rerender(<ExerciseReplacementDialog opened compatible busy
    onConfirm={onConfirm} onCancel={onCancel} />);
  expect(screen.getByRole('button', { name: 'Да' }).hasAttribute('disabled')).toBe(true);
});

it('offers only confirmation or rejection when tracking types differ', () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<ExerciseReplacementDialog opened compatible={false}
    onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog', { name: 'Сделать замену?' });
  expect(within(dialog).queryByRole('button', { name: 'Отмена' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Да' }));
  expect(onConfirm).toHaveBeenCalledWith(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Нет' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
