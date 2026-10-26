/** @vitest-environment jsdom */
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from '../data/cloud/workout-occurrence-plan';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { ProgramManagementRepository } from '../data/cloud/program-management';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, actorUserId: 'tg:101' }),
}));
vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => null }));
vi.mock('./WorkoutProgramSheet', () => ({ WorkoutProgramSheet: () => null }));
vi.mock('../workout/WorkoutPlanCard', () => ({
  WorkoutPlanCard: ({ onOpenSet }: { onOpenSet?: (exerciseId: string, setId: string) => void }) =>
    <button onClick={() => onOpenSet?.('exercise', 'set')}>Открыть подход в календаре</button>,
}));
vi.mock('../workout/SetEntry', () => ({
  SetEntry: ({ mode, onPlanSave }: {
    mode: string;
    onPlanSave: (input: { weightKg: number; reps: number;
      durationSeconds: null; distanceMeters: null; setType: 'dropset' }) => Promise<void>;
  }) => <div role="dialog" aria-label="Календарный редактор подхода">
    <span data-testid="editor-domain">{mode}</span>
    <button onClick={() => { void onPlanSave({ weightKg: 72.5, reps: 10,
      durationSeconds: null, distanceMeters: null, setType: 'dropset' }); }}>
      Записать PLAN календаря
    </button>
  </div>,
}));
vi.mock('../ui', () => ({
  Avatar: ({ name }: { name: string }) => <span>{name}</span>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Icon: () => <span />,
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  IconButton: ({ label, onClick }: { label: string; onClick?: () => void }) =>
    <button aria-label={label} onClick={onClick} />,
  MezfitBottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
  DatePicker: () => null,
  TimePicker: () => null,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const programTemplate = { id: 'program-set', plannedWeightKg: null, plannedReps: null };
const originalPlan: WorkoutOccurrencePlan = {
  name: 'Силовая', comment: null,
  exercises: [{
    id: 'exercise', sourceProgramExerciseId: 'program-exercise', position: 0,
    exercise: { exerciseDefinitionId: '1', scope: 'public', name: 'Жим',
      nameEn: null, mediaUrl: null },
    notes: null, sets: [{
      id: 'set', sourceProgramSetId: programTemplate.id, position: 0,
      setType: null, setLabel: null, comment: null, materialLinks: [], chatLinks: [],
      plannedWeightKg: null, plannedReps: null, plannedDurationSeconds: null, plannedDistanceMeters: null,
    }],
  }],
};
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101', trainingPlanId: 'program',
  programDayId: 'day', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-26T08:00:00.000Z', durationMinutes: 60,
  plan: originalPlan, originalPlan, createdAt: '2026-10-25T09:00:00.000Z',
  updatedAt: '2026-10-25T09:00:00.000Z',
};

describe('occurrence-scoped SetEntry routing', () => {
  it('opens from a calendar set and saves numeric PLAN to the occurrence only', async () => {
    vi.spyOn(ProgramManagementRepository.prototype, 'trackingTypeForExercise')
      .mockResolvedValue('weight_reps');
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    let changed: LocalWorkoutOccurrenceDraft | undefined;
    vi.spyOn(drafts, 'enqueueEdit').mockImplementation(async (_id, apply) => {
      changed = apply(draft);
    });
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts}
      onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход в календаре' }));
    expect(await screen.findByTestId('editor-domain')).toHaveTextContent('occurrence-plan');
    fireEvent.click(screen.getByRole('button', { name: 'Записать PLAN календаря' }));
    await waitFor(() => expect(changed?.plan.exercises[0].sets[0]).toMatchObject({
      plannedWeightKg: 72.5, plannedReps: 10, setType: 'dropset',
    }));
    expect(originalPlan.exercises[0].sets[0].plannedWeightKg).toBeNull();
    expect(programTemplate.plannedWeightKg).toBeNull();
  });

  it('does not permit opening numeric PLAN when the calendar occurrence is read-only', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} readOnly
      onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход в календаре' }));
    expect(screen.queryByRole('dialog', { name: 'Календарный редактор подхода' })).toBeNull();
  });
});
