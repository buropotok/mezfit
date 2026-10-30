// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { WorkoutCompletionSheet } from './WorkoutCompletionSheet';
vi.mock('../schedule/WorkoutPerson', () => ({ useWorkoutPerson: (id: string) => ({ name: id, avatar: <span>Аватар</span> }) }));
vi.mock('konsta/react', () => ({ Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button disabled={disabled} onClick={onClick}>{children}</button> }));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  GlassSurface: ({ children, onClick, disabled, 'aria-label': label, 'aria-expanded': expanded }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick} aria-label={label} aria-expanded={expanded}>{children}</button>,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Icon: () => <span />,
  IconButton: ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) =>
    <button aria-label={label} disabled={disabled} onClick={onClick} />,
  MezfitBottomSheet: ({ opened, label, children }: { opened: boolean; label: string; children: ReactNode }) =>
    opened ? <div role="dialog" aria-label={label}>{children}</div> : null,
  DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (value: string) => void }) =>
    opened ? <button onClick={() => onChange('2026-11-01')}>Новая дата</button> : null,
  TimePicker: ({ opened, onChange, onClose }: { opened: boolean; onChange: (value: string) => void; onClose: () => void }) =>
    opened ? <button onClick={() => { onChange('13:00'); onClose(); }}>Новое время</button> : null,
}));
vi.mock('./WorkoutPlanCard', () => ({
  WorkoutPlanCardHeader: ({ name, programName, scheduledTiming }: { name: string; programName: string;
    scheduledTiming: { date: string; time: string } }) => <span>{name} {programName} {scheduledTiming.date} {scheduledTiming.time}</span>,
}));
const row: CloudWorkoutOccurrenceRow = { id: 'one', realmId: 'pair', owner: 'pair',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
  startsAtUtc: '2026-10-30T10:00:00.000Z', durationMinutes: 60, status: 'scheduled',
  workoutSessionId: null, plan: { name: 'День 1', comment: null, exercises: [] } };
function setup() {
  const props = { rows: [row, { ...row, id: 'two', plan: { ...row.plan, name: 'День 2' } }],
    busy: false, onClose: vi.fn(), onCancel: vi.fn(), onMove: vi.fn(), onKeep: vi.fn(), onError: vi.fn() };
  render(<WorkoutCompletionSheet {...props} />);
  return props;
}
afterEach(cleanup);
it('shows collapsed cards and expands exactly one set of three actions under the chosen workout', () => {
  const props = setup();
  expect(screen.getByText('С завершённой тренировкой пересекаются запланированные тренировки. Нажмите на тренировку для выбора действия')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Отменить тренировку' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Действия: tg:202, День 1' }));
  expect(screen.getAllByRole('button', { name: 'Отменить тренировку' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Действия: tg:202, День 2' }));
  expect(screen.getByRole('button', { name: 'Действия: tg:202, День 1' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Оставить как есть' }));
  expect(props.onKeep).toHaveBeenCalledWith('two');
  fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
  expect(props.onCancel).toHaveBeenCalledWith(props.rows[1]);
});
it('moves the selected workout through existing date/time pickers without changing its duration', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Действия: tg:202, День 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Перенести тренировку' }));
  const dialog = screen.getByRole('dialog', { name: 'Перенести тренировку' });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Дата:/ }));
  fireEvent.click(screen.getByText('Новая дата'));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Начало:/ }));
  fireEvent.click(screen.getByText('Новое время'));
  expect(screen.getByText('Длительность: 60 мин')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Перенести', exact: true }));
  expect(props.onMove).toHaveBeenCalledWith(row, new Date(2026, 10, 1, 13, 0).toISOString());
  expect(props.onCancel).not.toHaveBeenCalled();
});
it('allows closing without resolving or changing workouts', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть пересечения' }));
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(props.onCancel).not.toHaveBeenCalled(); expect(props.onMove).not.toHaveBeenCalled(); expect(props.onKeep).not.toHaveBeenCalled();
});
