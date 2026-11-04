// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { WorkoutRepeatControl } from './WorkoutRepeatControl';

vi.mock('./Badge', () => ({
  BadgeChoice: ({ children, onClick, color, selected, disabled }: {
    children: ReactNode; onClick: () => void; color?: string; selected?: boolean; disabled?: boolean;
  }) => <button data-color={color} data-selected={selected} onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('./konsta-mezfit/Dialog', () => ({
  MezfitDialog: ({ opened, title, children, buttons }: {
    opened: boolean; title: ReactNode; children: ReactNode; buttons: ReactNode;
  }) => opened ? <div role="dialog" aria-label="Настройка повторения">{title}{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: {
    children: ReactNode; onClick: () => void; disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));
vi.mock('./primitives', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

afterEach(cleanup);
const start = new Date(2026, 10, 2, 8).toISOString(); // Monday local

it('offers an idle gray badge and applies weekly days through MezfitDialog', () => {
  const onChange = vi.fn();
  render(<WorkoutRepeatControl value={null} startsAtUtc={start} onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'Повторять' });
  expect(trigger.getAttribute('data-color')).toBe('gray');
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Настройка повторения' });
  fireEvent.click(screen.getByRole('button', { name: 'Ср' }));
  fireEvent.click(screen.getByRole('button', { name: '4 нед.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  expect(onChange).toHaveBeenCalledWith({ weekdays: [1, 3], weeks: 4 });
  expect(dialog.isConnected).toBe(false);
});

it('renders the active schedule as a green badge and prevents editing a materialized series', () => {
  const onChange = vi.fn();
  render(<WorkoutRepeatControl value={{ weekdays: [1, 3, 5], weeks: 4 }}
    startsAtUtc={start} onChange={onChange} locked />);
  const badge = screen.getByRole('button', { name: 'Пн/Ср/Пт · 4н' });
  expect(badge.getAttribute('data-color')).toBe('green');
  fireEvent.click(badge);
  expect(screen.getByText(/Серия уже создана/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Применить' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onChange).not.toHaveBeenCalled();
});

it('can clear a selected but not yet published repeat rule', () => {
  const onChange = vi.fn();
  render(<WorkoutRepeatControl value={{ weekdays: [1], weeks: 2 }}
    startsAtUtc={start} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Пн · 2н' }));
  fireEvent.click(screen.getByRole('button', { name: 'Без повторения' }));
  expect(onChange).toHaveBeenCalledWith(null);
});
