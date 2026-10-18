// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
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
  it('can save the last persisted version after an edit failed', async () => {
    const edit = vi.fn().mockRejectedValue(new Error('Недостаточно места'));
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = { edit, get } as unknown as WorkoutOccurrenceDraftRepository;
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Недостаточно места');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
  });

  it('waits for the latest queued edit before reading and confirming the draft', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = { edit: vi.fn(() => pending), get } as unknown as WorkoutOccurrenceDraftRepository;
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(get).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
  });
});
