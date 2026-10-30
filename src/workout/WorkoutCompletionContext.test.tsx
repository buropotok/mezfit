// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { WorkoutCompletionProvider, useWorkoutCompletionReview } from './WorkoutCompletionContext';
const state = vi.hoisted(() => ({ db: {}, next: null as null | ((rows: CloudWorkoutOccurrenceRow[]) => void),
  observe: vi.fn(), unsubscribe: vi.fn(), cancel: vi.fn(), move: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101' }) }));
vi.mock('../data/cloud/workout-completion-review', () => ({ WorkoutCompletionReviewRepository: class {
  observe(id: string, next: (rows: CloudWorkoutOccurrenceRow[]) => void) {
    state.observe(id); state.next = next; return { unsubscribe: state.unsubscribe };
  }
  cancel = state.cancel; move = state.move;
} }));
vi.mock('konsta/react', () => ({
  Toast: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div role="alert">{children}</div> : null,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock('../ui', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('./WorkoutCompletionSheet', () => ({
  WorkoutCompletionSheet: ({ rows, onClose, onKeep, onCancel, onMove, busy }: {
    rows: CloudWorkoutOccurrenceRow[]; onClose: () => void; onKeep: (id: string) => void; busy: boolean;
    onCancel: (row: CloudWorkoutOccurrenceRow) => void; onMove: (row: CloudWorkoutOccurrenceRow, startsAtUtc: string) => void;
  }) => <div role="dialog">
    <button onClick={onClose}>Закрыть</button>
    {rows.map(row => <section key={row.id}>{row.plan.name}
      <button disabled={busy} onClick={() => onKeep(row.id)}>Оставить {row.id}</button>
      <button disabled={busy} onClick={() => onCancel(row)}>Отменить {row.id}</button>
      <button disabled={busy} onClick={() => onMove(row, '2026-11-01T10:00:00.000Z')}>Перенести {row.id}</button>
    </section>)}
  </div>,
}));
const row: CloudWorkoutOccurrenceRow = { id: 'one', realmId: 'pair', owner: 'pair',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
  startsAtUtc: '2026-10-30T10:00:00.000Z', durationMinutes: 60, status: 'scheduled',
  workoutSessionId: null, plan: { name: 'День 1', comment: null, exercises: [] } };
function Trigger() {
  const review = useWorkoutCompletionReview();
  return <button onClick={() => review?.reviewCompleted('completed')}>После завершения</button>;
}
const nav = vi.fn();
function view(scope = 'training', child = true) {
  return <WorkoutCompletionProvider enabled scope={scope} onNavigationContextChange={nav}>
    {child ? <Trigger /> : null}
  </WorkoutCompletionProvider>;
}
beforeEach(() => { vi.resetAllMocks(); state.next = null; state.cancel.mockResolvedValue(undefined); state.move.mockResolvedValue(undefined); });
afterEach(cleanup);
it('does not check on mount; survives the completing screen unmount and does not reopen a dismissed review', async () => {
  const mounted = render(view());
  expect(state.observe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('После завершения'));
  await waitFor(() => expect(state.observe).toHaveBeenCalledExactlyOnceWith('completed'));
  mounted.rerender(view('training', false));
  act(() => state.next?.([row]));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Закрыть'));
  expect(screen.queryByRole('dialog')).toBeNull();
  mounted.rerender(view());
  fireEvent.click(screen.getByText('После завершения'));
  expect(state.observe).toHaveBeenCalledOnce();
  expect(state.cancel).not.toHaveBeenCalled();
});
it('keeps one decision without writing and closes after the remaining row disappears externally', async () => {
  render(view()); fireEvent.click(screen.getByText('После завершения'));
  await waitFor(() => expect(state.observe).toHaveBeenCalled());
  act(() => state.next?.([row, { ...row, id: 'two', plan: { ...row.plan, name: 'День 2' } }]));
  fireEvent.click(screen.getByText('Оставить one'));
  act(() => state.next?.([row, { ...row, id: 'two' }]));
  expect(screen.queryByText('Оставить one')).toBeNull();
  expect(screen.getByText('Оставить two')).toBeTruthy();
  act(() => state.next?.([row]));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.cancel).not.toHaveBeenCalled(); expect(state.move).not.toHaveBeenCalled();
});
it('keeps a failed action visible with a bottom toast; successful writes await authoritative updates', async () => {
  state.cancel.mockRejectedValueOnce(new Error('Не удалось отменить'));
  render(view()); fireEvent.click(screen.getByText('После завершения'));
  await waitFor(() => expect(state.observe).toHaveBeenCalled());
  act(() => state.next?.([row]));
  fireEvent.click(screen.getByText('Отменить one'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Не удалось отменить'));
  expect(screen.getByText('Отменить one')).toBeTruthy();
  fireEvent.click(screen.getByText('Перенести one'));
  await waitFor(() => expect(state.move).toHaveBeenCalledWith('completed', 'one', '2026-11-01T10:00:00.000Z'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => state.next?.([]));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('cleans up on navigation and ignores late observation callbacks', async () => {
  const mounted = render(view()); fireEvent.click(screen.getByText('После завершения'));
  await waitFor(() => expect(state.observe).toHaveBeenCalled());
  const late = state.next;
  mounted.rerender(view('today'));
  mounted.rerender(view('training'));
  act(() => late?.([row]));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.unsubscribe).toHaveBeenCalled();
});
