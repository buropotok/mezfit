// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { OccurrenceDraftCard } from './OccurrenceDraftSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('../workout/WorkoutPlanCard', () => ({ WorkoutPlanCard: () => <div>План</div>, WorkoutPlanCardHeader: () => null }));
vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('./WorkoutPerson', () => ({ useWorkoutPerson: () => ({ name: 'Андрей', avatar: null, compactAvatar: null }) }));
afterEach(cleanup);
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:workout', targetOccurrenceId: 'workout', actorUserId: 'tg:101', realmId: 'tg:101',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent', saved: true,
  startsAtUtc: '2026-10-28T10:00:00.000Z', durationMinutes: 60,
  plan: { name: 'Силовая', comment: null, exercises: [] }, originalPlan: { name: 'Силовая', comment: null, exercises: [] },
  createdAt: '2026-10-28T09:00:00.000Z', updatedAt: '2026-10-28T09:00:00.000Z',
};
function props() {
  const repository = { pendingEditError: vi.fn(() => ''), flushEdits: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(draft), delete: vi.fn() };
  return { draft, drafts: repository as unknown as WorkoutOccurrenceDraftRepository, collapsed: false,
    onCollapsedChange: vi.fn(), onClose: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined) };
}
describe('scheduled workout cancellation actions', () => {
  it('places Delete after Cancel and flushes the current PLAN before asking its owner to close the sheet', async () => {
    const input = props(); render(<OccurrenceDraftCard {...input} />);
    const buttons = screen.getAllByRole('button').map(button => button.textContent);
    expect(buttons.indexOf('Отменить тренировку')).toBeLessThan(buttons.indexOf('Удалить'));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    await waitFor(() => expect(input.onCancel).toHaveBeenCalledWith(draft));
    expect(input.drafts.flushEdits).toHaveBeenCalledWith(draft.id);
    expect(input.drafts.delete).not.toHaveBeenCalled();
  });
  it('offers logical deletion for a read-only cancelled record, with no Restore action', async () => {
    const input = props(); render(<OccurrenceDraftCard {...input} cancelled readOnly planLocked />);
    expect(screen.queryByRole('button', { name: 'Отменить тренировку' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Восстановить/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirm = screen.getByRole('dialog', { name: 'Удалить тренировку?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(input.onDelete).toHaveBeenCalledWith(draft));
    expect(input.drafts.delete).not.toHaveBeenCalled();
  });
});
