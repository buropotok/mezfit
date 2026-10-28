// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ScheduleWorkoutCreator } from './ScheduleWorkoutCreator';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: database, actorUserId: 'tg:101', clients: [], coaches: [], status: 'ready',
}) }));
const database = {};
vi.mock('../data/cloud/workout-planning', () => ({ WorkoutPlanningRepository: class {
  actorUserId = 'tg:101';
  programs = { listForScheduling: async () => [{ id: 'chosen-program', name: 'Выбранная программа', status: 'active',
    athleteUserId: 'tg:101', coachUserId: null, clientUserId: null }] };
} }));
vi.mock('../program/ProgramClientPicker', () => ({ ProgramClientPicker: () => null }));
vi.mock('../program/CloudProgramDetailsPage', () => ({ CloudProgramDetailsPage: ({ planId }: { planId: string }) => <div>Детали {planId}</div> }));
vi.mock('konsta/react', () => ({ Toast: () => null,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Avatar: () => null, Badge: () => null,
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
  MezfitDialog: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
  MezfitDialogButton: () => null,
}));
afterEach(cleanup);
it('returns to the same selected program after conflict resolution without resetting the creator intent', async () => {
  const props = { intent: 'workout' as const, role: 'coach' as const, mode: 'start' as const,
    onClose: vi.fn(), onCreated: vi.fn(), onNavigationContextChange: vi.fn(), onStartWorkout: vi.fn() };
  const view = render(<ScheduleWorkoutCreator {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Моя тренировка' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Выбранная программа' }));
  expect(screen.getByText('Детали chosen-program')).toBeTruthy();
  view.rerender(<ScheduleWorkoutCreator {...props} suspended />);
  expect(screen.queryByText('Детали chosen-program')).toBeNull();
  view.rerender(<ScheduleWorkoutCreator {...props} suspended={false} />);
  expect(screen.getByText('Детали chosen-program')).toBeTruthy();
  expect(props.onClose).not.toHaveBeenCalled();
});
