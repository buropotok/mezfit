// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientWorkoutProvider, useClientWorkout } from './ClientWorkoutContext';
import type { AdHocOpenSession } from '../data/cloud/adhoc-workouts';

const state = vi.hoisted(() => ({ db: {}, actor: 'tg:202', subscriptions: [] as {
  actor: string; next: (rows: AdHocOpenSession[]) => void; error: (reason: unknown) => void; unsubscribe: ReturnType<typeof vi.fn>;
}[] }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: state.actor }),
}));
vi.mock('../data/cloud/client-workouts', () => ({ ClientWorkoutRepository: class {
  constructor(_db: unknown, readonly actorUserId: string) {}
  observeOpen(next: (rows: AdHocOpenSession[]) => void, error: (reason: unknown) => void) {
    const subscription = { actor: this.actorUserId, next, error, unsubscribe: vi.fn() };
    state.subscriptions.push(subscription);
    return subscription;
  }
} }));
function Consumer() {
  const workout = useClientWorkout();
  return <><span>{workout?.loaded ? 'loaded' : 'loading'}</span>
    <span>{workout?.sessions.map(row => row.id).join(',')}</span><span>{workout?.error}</span>
    <button onClick={workout?.retry}>retry</button></>;
}
beforeEach(() => { state.actor = 'tg:202'; state.subscriptions = []; });
afterEach(cleanup);
const active: AdHocOpenSession[] = [{ id: 'shared-fact', name: 'Workout', status: 'active' }];
describe('Client active-session owner', () => {
  it('observes reactive local Start/completion once and cleans up on role exit', () => {
    const view = render(<ClientWorkoutProvider enabled><Consumer /></ClientWorkoutProvider>);
    expect(state.subscriptions).toHaveLength(1);
    act(() => state.subscriptions[0].next(active));
    expect(screen.getByText('shared-fact')).toBeTruthy();
    expect(screen.getByText('loaded')).toBeTruthy();
    act(() => state.subscriptions[0].next([]));
    expect(screen.queryByText('shared-fact')).toBeNull();
    view.rerender(<ClientWorkoutProvider enabled={false}><Consumer /></ClientWorkoutProvider>);
    expect(state.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    act(() => state.subscriptions[0].next(active));
    expect(screen.queryByText('shared-fact')).toBeNull();
  });
  it('rejects stale callbacks after account changes and retries failed observation', () => {
    const view = render(<ClientWorkoutProvider enabled><Consumer /></ClientWorkoutProvider>);
    act(() => state.subscriptions[0].next(active));
    state.actor = 'tg:303';
    view.rerender(<ClientWorkoutProvider enabled><Consumer /></ClientWorkoutProvider>);
    expect(screen.queryByText('shared-fact')).toBeNull();
    act(() => state.subscriptions[0].next(active));
    expect(screen.queryByText('shared-fact')).toBeNull();
    act(() => state.subscriptions[1].error(new Error('Local read failed')));
    expect(screen.getByText('Local read failed')).toBeTruthy();
    fireEvent.click(screen.getByText('retry'));
    expect(state.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
    act(() => state.subscriptions[2].next([]));
    expect(screen.getByText('loaded')).toBeTruthy();
    expect(screen.queryByText('Local read failed')).toBeNull();
  });
});
