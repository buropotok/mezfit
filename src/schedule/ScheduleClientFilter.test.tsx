// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleClientFilter } from './ScheduleClientFilter';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: import('react').ReactNode }) => opened ? <div>{children}</div> : null,
}));
const clients = [
  { userId: 'tg:202', telegramUserId: '202', relationshipId: 'a', displayName: 'Анна' },
  { userId: 'tg:303', telegramUserId: '303', relationshipId: 'b', displayName: 'Борис' },
];
afterEach(cleanup);

it('selects all clients even during search and applies only on confirmation', () => {
  const apply = vi.fn();
  render(<ScheduleClientFilter opened clients={clients} loading={false} selected={[]}
    onApply={apply} onClose={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText('Поиск клиента'), { target: { value: 'Анна' } });
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }));
  expect(apply).not.toHaveBeenCalled();
  const anna = screen.getByRole('button', { name: 'Выбрать клиента Анна' });
  expect(anna.getAttribute('aria-pressed')).toBe('true');
  expect(anna.className).toContain('w-full');
  // Both avatar and trailing space belong to the same native row button.
  fireEvent.click(within(anna).getByText('А'));
  expect(anna.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(anna.lastElementChild!);
  expect(anna.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Применить фильтр' }));
  expect(apply).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledWith(expect.arrayContaining(['tg:202', 'tg:303']));
  expect(apply.mock.calls[0][0]).toHaveLength(2);
});
