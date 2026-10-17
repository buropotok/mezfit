// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { ProgramDayExercisePicker } from './ProgramDayExercisePicker';

vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({
  WorkoutExerciseSelectionSheet: ({ opened, saving, actionError, onConfirm, onClose, onClosed }: {
    opened: boolean; saving: boolean; actionError: string; onConfirm: (ids: string[]) => void;
    onClose: () => void; onClosed: () => void;
  }) => <div data-testid="picker" data-open={opened}>
    {actionError ? <span role="alert">{actionError}</span> : null}
    <button disabled={saving} onClick={() => onConfirm(['0001', '0002'])}>Выбрать</button>
    <button disabled={saving} onClick={onClose}>Закрыть</button>
    {!opened ? <button onClick={onClosed}>Анимация закрытия завершена</button> : null}
  </div>,
}));
afterEach(cleanup);
const program: CloudTrainingPlanRow = { id: 'plan', realmId: 'tg:101', owner: 'tg:101',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, name: 'План', status: 'draft',
  position: 0, startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' };
function fixture(add = vi.fn(async () => {})) {
  const repo = { addDayExercises: add };
  const close = vi.fn();
  const page = <ProgramDayExercisePicker repository={repo as unknown as ProgramManagementRepository}
    program={program} dayId="chosen-day" onClose={close} />;
  return { add, close, page };
}

describe('program day exercise selection', () => {
  it('saves to the chosen day and waits for sheet closing before disposing it', async () => {
    const f = fixture(); render(f.page);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    await waitFor(() => expect(f.add).toHaveBeenCalledWith('plan', 'chosen-day', ['0001', '0002']));
    expect(screen.queryByRole('dialog', { name: 'Тип учёта' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('picker').getAttribute('data-open')).toBe('false'));
    expect(f.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Анимация закрытия завершена' }));
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('keeps the sheet on save failure, retries and blocks duplicate submissions', async () => {
    let reject: (error: Error) => void = () => {};
    const add = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const f = fixture(add); render(f.page);
    const choose = screen.getByRole('button', { name: 'Выбрать' });
    fireEvent.click(choose); fireEvent.click(choose);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await act(async () => { reject(new Error('Нет места на устройстве')); });
    expect(screen.getByRole('alert').textContent).toBe('Нет места на устройстве');
    expect(screen.getByTestId('picker').getAttribute('data-open')).toBe('true');
    fireEvent.click(choose);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  });
  it('ignores late save completion after navigation away', async () => {
    let complete: () => void = () => {};
    const add = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const f = fixture(add);
    const view = render(f.page);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    expect(add).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { complete(); });
    expect(f.close).not.toHaveBeenCalled();
  });
});
