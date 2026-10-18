// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { LiquidPopoverItem } from '../ui';
import { WorkoutPlanCard } from './WorkoutPlanCard';

vi.mock('../ui', () => ({
  Avatar: () => null,
  Icon: () => null,
  IconButton: () => null,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SortableList: ({ footer }: { footer: ReactNode }) => <div>{footer}</div>,
  GlassSurface: ({ children, onClick, 'aria-disabled': disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={Boolean(disabled)} onClick={onClick}>{children}</button>,
  LiquidPopover: ({ isOpen, onOpenChange, items, trigger }: {
    isOpen: boolean; onOpenChange: (open: boolean) => void;
    items: LiquidPopoverItem[]; trigger: ReactNode;
  }) => <div>
    <div onClick={() => onOpenChange(true)}>{trigger}</div>
    {isOpen ? items.map(item => <button key={item.id} onClick={() => item.onSelect?.()}>{item.label}</button>) : null}
  </div>,
}));
vi.mock('./SessionExercise', () => ({ SessionExercise: () => null }));
vi.mock('../glassSettings', () => ({ loadBrowserGlassSettings: () => ({}) }));
afterEach(cleanup);

const day: CloudProgramDayOutline = {
  day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase',
    name: 'День А', position: 0, status: 'active' },
  exercises: [],
};
const defaults = { mode: 'planning' as const, day, creatorName: 'Автор', hideProgramMenu: true,
  onEdit: () => {}, onComment: () => {}, onMove: () => {}, onDuplicate: () => {}, onDelete: () => {} };

describe('day scheduling formats', () => {
  it('schedules personal programs independently without offering a client workout', () => {
    const schedule = vi.fn();
    render(<WorkoutPlanCard {...defaults} onSchedule={schedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    expect(schedule).toHaveBeenCalledWith('independent');
    expect(screen.queryByText('В зале с клиентом')).toBeNull();
  });

  it.each(['coached', 'independent'] as const)('offers %s when coaching is supported', format => {
    const schedule = vi.fn();
    render(<WorkoutPlanCard {...defaults} canScheduleCoached onSchedule={schedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    expect(schedule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {
      name: format === 'coached' ? 'В зале с клиентом' : 'Самостоятельная',
    }));
    expect(schedule).toHaveBeenCalledWith(format);
  });
});
