// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleFilterBar } from './ScheduleFilterBar';
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  GlassSurface: ({ children }: { children: import('react').ReactNode }) => <div>{children}</div>,
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const clients = ['Анна', 'Борис', 'Вера'].map((displayName, index) => ({
  displayName, userId: 'tg:' + index, telegramUserId: String(index), relationshipId: String(index),
}));
it('fits whole chips, reserves All, and recalculates when the available width changes', () => {
  let width = 300;
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('today-page__filter-bar') ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const measured = this.classList.contains('today-page__all') ? 50 : 100;
    return { width: measured, height: 32, x: 0, y: 0, left: 0, top: 0, right: measured, bottom: 32, toJSON() {} };
  });
  const open = vi.fn();
  const remove = vi.fn();
  render(<ScheduleFilterBar clients={clients} selected={clients.map(client => client.userId)}
    onOpen={open} onRemove={remove} />);
  const chips = screen.getByLabelText('Выбранные клиенты');
  expect(within(chips).getByText('Анна')).toBeTruthy();
  expect(within(chips).queryByText('Борис')).toBeNull();
  fireEvent.click(within(chips).getByRole('button', { name: 'Все...' }));
  fireEvent.click(screen.getByRole('button', { name: 'Поиск клиента' }));
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(chips.querySelector('[role="button"]')!);
  expect(remove).toHaveBeenCalledWith('tg:0');
  width = 400;
  act(() => resize());
  expect(within(chips).getByText('Вера')).toBeTruthy();
  expect(within(chips).queryByRole('button', { name: 'Все...' })).toBeNull();
  width = 120;
  act(() => resize());
  expect(within(chips).queryByText('Анна')).toBeNull();
  expect(within(chips).getByRole('button', { name: 'Все...' })).toBeTruthy();
});
