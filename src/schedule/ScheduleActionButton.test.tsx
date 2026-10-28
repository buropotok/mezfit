// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleActionButton } from './ScheduleActionButton';
import { ScheduleFilterBar } from './ScheduleFilterBar';

const animation = vi.hoisted(() => ({ cancel: vi.fn(), start: vi.fn() }));
vi.mock('../ui/SpringScale', () => ({ startSpringScale: animation.start }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  GlassSurface: ({ children, preset, className }: {
    children: import('react').ReactNode; preset: string; className: string;
  }) => <div data-preset={preset} className={className}>{children}</div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('uses the same glass surface as search and announces the basket mode in both directions', () => {
  animation.start.mockReturnValue({ cancel: animation.cancel });
  function CalendarActions() {
    const [pressed, setPressed] = useState(false);
    return <>
      <ScheduleFilterBar clients={[]} selected={[]} onOpen={() => {}} onRemove={() => {}} />
      <ScheduleActionButton icon="trash" label="Отменённые тренировки" pressed={pressed}
        onClick={() => setPressed(value => !value)} />
    </>;
  }
  const view = render(<CalendarActions />);
  const search = screen.getByRole('button', { name: 'Поиск клиента' });
  const basket = screen.getByRole('button', { name: 'Отменённые тренировки' });
  expect(search.className).toBe(basket.className);
  expect(search.firstElementChild?.getAttribute('data-preset')).toBe('modalTuned');
  expect(basket.firstElementChild?.getAttribute('data-preset')).toBe('modalTuned');
  expect(animation.start).not.toHaveBeenCalled();
  fireEvent.click(basket);
  expect(basket.getAttribute('aria-pressed')).toBe('true');
  expect(animation.start).toHaveBeenLastCalledWith(basket);
  fireEvent.click(basket);
  expect(basket.getAttribute('aria-pressed')).toBe('false');
  expect(animation.start).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(animation.cancel).toHaveBeenCalled();
});
