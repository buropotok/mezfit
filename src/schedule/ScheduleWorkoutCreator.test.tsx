// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { ScheduleWorkoutCreator } from './ScheduleWorkoutCreator';

const state = vi.hoisted(() => ({
  readable: vi.fn(), authorable: vi.fn(), coaches: [] as CloudContact[],
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, actorUserId: 'tg:202', clients: [], coaches: state.coaches, status: 'ready' }),
}));
vi.mock('../data/cloud/workout-planning', () => ({
  WorkoutPlanningRepository: class {
    actorUserId = 'tg:202';
    programs = { listForAthlete: state.readable, listForScheduling: state.authorable };
  },
}));
vi.mock('../program/ProgramClientPicker', () => ({ ProgramClientPicker: ({ opened, onSelect }: { opened: boolean; onSelect: (client: { userId: string }) => void }) =>
  opened ? <button onClick={() => onSelect({ userId: 'tg:303' })}>Выбрать Анну</button> : null }));
vi.mock('../program/CloudProgramDetailsPage', () => ({
  CloudProgramDetailsPage: ({ planId, readOnly, selectionMode }: { planId: string; readOnly?: boolean; selectionMode?: boolean }) =>
    <div data-testid="program-details" data-plan={planId} data-readonly={Boolean(readOnly)} data-selection={Boolean(selectionMode)} />,
}));
vi.mock('konsta/react', () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, after, subtitle, media, onClick }: { title: string; after?: ReactNode; subtitle?: ReactNode; media?: ReactNode; onClick: () => void }) =>
    <>{media}<button onClick={onClick}>{title} {after}</button>{subtitle ? <span>{subtitle}</span> : null}</>,
}));
vi.mock('../ui', () => ({
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
  MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children: ReactNode; buttons: ReactNode }) => opened ? <div>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  Avatar: ({ name }: { name: string }) => <span role="img" aria-label={name} />,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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
beforeEach(() => { vi.clearAllMocks(); state.coaches = []; state.readable.mockResolvedValue([assigned]); state.authorable.mockResolvedValue([personal]); });
afterEach(cleanup);

describe('calendar program source permissions', () => {
  it('lists active coach assignments before opening an athlete-readable source', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    const source = await screen.findByRole('button', { name: 'От тренера Активная' });
    expect(screen.queryByTestId('program-details')).toBeNull();
    fireEvent.click(source);
    const details = screen.getByTestId('program-details');
    expect(details.getAttribute('data-selection')).toBe('true');
    expect(state.readable).toHaveBeenCalledOnce();
    expect(state.authorable).not.toHaveBeenCalled();
    expect(details.getAttribute('data-plan')).toBe('assigned');
    expect(details.getAttribute('data-readonly')).toBe('true');
  });

  it('shows inactive visible assignments in the source list and opens them read-only', async () => {
    state.readable.mockResolvedValue([{ ...assigned, status: 'finished' }]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    expect(await screen.findByText('Только просмотр: для планирования тренер должен активировать программу и фазу.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'От тренера Завершена' }));
    expect(screen.getByTestId('program-details').getAttribute('data-readonly')).toBe('true');
  });

  it('separates personal source authorization from selection mode', async () => {
    state.readable.mockResolvedValue([personal]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Личная Активная' }));
    expect(screen.getByTestId('program-details').getAttribute('data-readonly')).toBe('false');
    expect(screen.getByTestId('program-details').getAttribute('data-selection')).toBe('true');
  });

  it('keeps coach source selection within the selected authoring scope', async () => {
    open('coach');
    fireEvent.click(screen.getByRole('button', { name: 'Моя тренировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    await waitFor(() => expect(state.authorable).toHaveBeenCalledWith('tg:202'));
    expect(state.readable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Личная Активная' }));
    expect(screen.getByTestId('program-details').getAttribute('data-readonly')).toBe('false');
  });
  it('uses the chosen client and returns from details to the source list', async () => {
    state.authorable.mockResolvedValue([{ ...assigned, clientUserId: 'tg:303', athleteUserId: 'tg:303' }]);
    open('coach');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать клиента' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать Анну' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    fireEvent.click(await screen.findByRole('button', { name: 'От тренера Активная' }));
    expect(state.authorable).toHaveBeenCalledWith('tg:303');
    expect(screen.getByTestId('program-details').getAttribute('data-selection')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByTestId('program-details')).toBeNull();
    expect(screen.getByRole('button', { name: 'От тренера Активная' })).toBeTruthy();
  });

  it('labels every source program status', async () => {
    state.readable.mockResolvedValue(['active', 'draft', 'finished', 'cancelled'].map(status => ({
      ...personal, id: status, name: status, status,
    })));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    for (const label of ['active Активная', 'draft Черновик', 'finished Завершена', 'cancelled Отменена'])
      expect(await screen.findByRole('button', { name: label })).toBeTruthy();
  });

  it('shows each coach owner from the matching relationship in the leading slot', async () => {
    state.coaches = [
      { userId: 'tg:101', telegramUserId: '101', relationshipId: 'other', displayName: 'Чужая связь' },
      { userId: 'tg:101', telegramUserId: '101', relationshipId: 'relationship', displayName: 'Иван' },
      { userId: 'tg:404', telegramUserId: '404', relationshipId: 'second', displayName: 'Мария' },
    ];
    state.readable.mockResolvedValue([assigned, { ...assigned, id: 'second', realmId: 'second', coachUserId: 'tg:404' }]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    expect(await screen.findByLabelText('Владелец: Иван')).toBeTruthy();
    expect(screen.getByLabelText('Владелец: Мария')).toBeTruthy();
    expect(screen.queryByText('Чужая связь')).toBeNull();
  });

  it('identifies a personal owner and falls back honestly when a coach profile is unavailable', async () => {
    state.readable.mockResolvedValue([personal, assigned]);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать из программы' }));
    expect(await screen.findByLabelText('Владелец: Вы')).toBeTruthy();
    expect(screen.getByLabelText('Владелец: Автор программы')).toBeTruthy();
  });
});
