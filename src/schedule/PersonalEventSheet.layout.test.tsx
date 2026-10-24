// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PersonalEventSheet } from './PersonalEventSheet';

vi.mock('konsta/react', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  List: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
  ListInput: ({ label, type }: { label: string; type: string }) =>
    type === 'textarea' ? <textarea aria-label={label} readOnly /> : <input aria-label={label} readOnly />,
}));
vi.mock('../ui/primitives', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock('../ui/Icon', () => ({ Icon: () => <span aria-hidden="true" /> }));
vi.mock('../ui', () => ({
  Text: ({ children, className }: { children: ReactNode; className?: string }) =>
    <span className={className}>{children}</span>,
  MezfitBottomSheet: ({ children, opened }: { children: ReactNode; opened: boolean }) =>
    opened ? <div role="dialog">{children}</div> : null,
  DatePicker: () => null,
  TimePicker: () => null,
  MezfitDialog: () => null,
  MezfitDialogButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock('./PersonalEventStatuses', () => ({
  PersonalEventStatuses: () => <div data-testid="personal-event-statuses" />,
}));

afterEach(cleanup);

it('places date and time immediately after statuses, before both outlined fields', () => {
  render(<PersonalEventSheet opened event={null} date="2026-10-24" repository={null}
    onClose={() => {}} onSaved={() => {}} />);

  const body = screen.getByRole('dialog').querySelector('.personal-event-sheet__body');
  expect(body).not.toBeNull();
  const children = Array.from(body!.children);
  const status = children.findIndex(element => element.hasAttribute('data-testid'));
  const timing = children.findIndex(element => element.classList.contains('personal-event-sheet__timing'));
  const fields = children.filter(element => element.classList.contains('personal-event-sheet__field-list'));

  expect(status).toBeGreaterThanOrEqual(0);
  expect(timing).toBe(status + 1);
  expect(fields).toHaveLength(2);
  expect(children.indexOf(fields[0])).toBeGreaterThan(timing);
  expect(children.indexOf(fields[1])).toBeGreaterThan(children.indexOf(fields[0]));
  expect(screen.getByRole('button', { name: /Дата: 2026-10-24/ })).not.toBeNull();
  expect(screen.getByRole('button', { name: /Начало: 09:00/ })).not.toBeNull();
  expect(screen.getByRole('button', { name: /Конец: 10:00/ })).not.toBeNull();
});
