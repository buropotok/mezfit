// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { ScheduleWorkoutCreator } from './ScheduleWorkoutCreator';

const state = vi.hoisted(() => ({
  readable: vi.fn(), authorable: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, actorUserId: 'tg:202', clients: [], status: 'ready' }),
}));
vi.mock('../data/cloud/workout-planning', () => ({
  WorkoutPlanningRepository: class {
    actorUserId = 'tg:202';
    programs = { listForAthlete: state.readable, listForScheduling: state.authorable };
  },
}));
vi.mock('../program/ProgramClientPicker', () => ({ ProgramClientPicker: () => null }));
vi.mock('../program/CloudProgramDetailsPage', () => ({
  CloudProgramDetailsPage: ({ planId, readOnly }: { planId: string; readOnly?: boolean }) =>
    <div data-testid="program-details" data-plan={planId} data-readonly={Boolean(readOnly)} />,
}));
vi.mock('konsta/react', () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, onClick }: { title: string; onClick: () => void }) =>
    <button onClick={onClick}>{title}</button>,
}));
vi.mock('../ui', () => ({
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
  MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children: ReactNode; buttons: ReactNode }) => opened ? <div>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const assigned: CloudTrainingPlanRow = {
  id: 'assigned', realmId: 'relationship', owner: null, athleteUserId: 'tg:202',
  coachUserId: 'tg:101', clientUserId: 'tg:202', name: 'От тренера', status: 'active',
  position: 0, startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
};
const personal: CloudTrainingPlanRow = {
  ...assigned, id: 'personal', realmId: 'tg:202', owner: 'tg:202',
  coachUserId: null, clientUserId: null, name: 'Личная',
};
const open = (role: 'coach' | 'client' = 'client') =>
  render(<ScheduleWorkoutCreator intent="workout" role={role}
    onClose={vi.fn()} onCreated={vi.fn()} onNavigationContextChange={vi.fn()} />);
beforeEach(() => { vi.clearAllMocks(); state.readable.mockResolvedValue([assigned]); state.authorable.mockResolvedValue([personal]); });
afterEach(cleanup);

describe('calendar program source permissions', () => {
  it('opens an active coach assignment for a client through the athlete-readable query', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    const details = await screen.findByTestId('program-details');
    expect(state.readable).toHaveBeenCalledOnce();
    expect(state.authorable).not.toHaveBeenCalled();
    expect(details.getAttribute('data-plan')).toBe('assigned');
    expect(details.getAttribute('data-readonly')).toBe('true');
  });

  it('shows inactive visible assignments in the source list and opens them read-only', async () => {
    state.readable.mockResolvedValue([{ ...assigned, status: 'finished' }]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    fireEvent.click(await screen.findByRole('button', { name: 'От тренера' }));
    expect(screen.getByTestId('program-details').getAttribute('data-readonly')).toBe('true');
  });

  it('keeps a client personal program editable', async () => {
    state.readable.mockResolvedValue([personal]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    expect((await screen.findByTestId('program-details')).getAttribute('data-readonly')).toBe('false');
  });

  it('keeps coach source selection within the selected authoring scope', async () => {
    open('coach');
    fireEvent.click(screen.getByRole('button', { name: 'Моя тренировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    await waitFor(() => expect(state.authorable).toHaveBeenCalledWith('tg:202'));
    expect(state.readable).not.toHaveBeenCalled();
    expect((await screen.findByTestId('program-details')).getAttribute('data-readonly')).toBe('false');
  });
});
