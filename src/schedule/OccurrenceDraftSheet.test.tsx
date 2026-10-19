// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => null }));
vi.mock('../workout/WorkoutPlanCard', () => ({
  WorkoutPlanCard: ({ onAddSet }: { onAddSet?: (id: string) => void }) =>
    <button onClick={() => onAddSet?.('exercise')}>Добавить подход</button>,
}));
vi.mock('../ui', () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  IconButton: () => null, Icon: () => null, DatePicker: () => null, TimePicker: () => null,
  Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span>,
  MezfitBottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MezfitDialog: () => null, MezfitDialogButton: () => null,
}));
afterEach(cleanup);
const plan = { name: 'День', comment: null, exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101', trainingPlanId: 'program',
  programDayId: 'day', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
  plan, originalPlan: plan, createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z',
};

describe('draft edit recovery', () => {
  it('reports a write which failed after navigating away when the editor is reopened', async () => {
    let rejectWrite: (reason: Error) => void = () => {};
    const pending = new Promise<void>((_, reject) => { rejectWrite = reject; });
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    const edit = vi.spyOn(drafts, 'edit').mockImplementationOnce(() => pending)
      .mockRejectedValue(new Error('Нет места'));
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { rejectWrite(new Error('Нет места')); });
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Нет места');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(save).not.toHaveBeenCalled();
  });

  it('retries the failed intent and blocks confirmation until it is persisted', async () => {
    const edit = vi.fn().mockRejectedValue(new Error('Недостаточно места'));
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'edit').mockImplementation(edit);
    vi.spyOn(drafts, 'get').mockImplementation(get);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Недостаточно места');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(false));
    edit.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
    expect(edit.mock.calls[2][1]).toBe(edit.mock.calls[0][1]);
  });

  it('waits for the latest queued edit before reading and confirming the draft', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'edit').mockImplementation(() => pending);
    vi.spyOn(drafts, 'get').mockImplementation(get);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    finish();
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
  });
});
