// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionDestination } from '../data/cloud/discussion-destination';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { DiscussionThread } from '../data/cloud/discussion-contracts';
import type { NavigationContext } from '../NavigationShell';
import { DiscussionEntity } from './DiscussionEntity';
import { thread } from './discussion-fixture.test-support';

const state = vi.hoisted(() => ({
  db: {},
  next: null as ((target: DiscussionDestination) => void) | null,
  fail: null as (() => void) | null,
  unsubscribe: vi.fn(), observe: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:11' }) }));
vi.mock('../data/cloud/program-management', () => ({ ProgramManagementRepository: class {} }));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({ WorkoutOccurrenceDraftRepository: class {} }));
vi.mock('../data/cloud/discussion-destination', () => ({ observeDiscussionDestination: (
  _db: unknown, actor: string, role: string, exactThread: DiscussionThread,
  next: (target: DiscussionDestination) => void, fail: () => void,
) => { state.observe(actor, role, exactThread); state.next = next; state.fail = fail; return { unsubscribe: state.unsubscribe }; } }));
vi.mock('../program/CloudProgramDetailsPage', () => ({ CloudProgramDetailsPage: ({ planId }: { planId: string }) => <div>Программа {planId}</div> }));
vi.mock('../schedule/OccurrenceDraftSheet', () => ({ OccurrenceDraftSheet: ({ focusExerciseId, focusSetId }: {
  focusExerciseId?: string; focusSetId?: string;
}) => <><div>Плановая тренировка</div><div data-testid="planned-focus">{[focusExerciseId, focusSetId].filter(Boolean).join('/')}</div></> }));
vi.mock('../workout/WorkoutSessionCard', () => ({ WorkoutSessionCard: () => <div>Выполнение</div> }));
afterEach(() => { cleanup(); state.next = null; state.fail = null; vi.clearAllMocks(); });

it.each(['coach', 'client'] as const)('keeps missing targets readable and Back available for %s without opening another entity', role => {
  const back = vi.fn(), navigation = vi.fn();
  render(<DiscussionEntity thread={thread} role={role} onBack={back} onNavigationContextChange={navigation} />);
  expect(state.observe).toHaveBeenCalledWith('tg:11', role, thread);
  act(() => state.next?.({ kind: 'unavailable' }));
  expect(screen.getByText('Сущность удалена или недоступна на этом устройстве. Переписка сохранена.')).toBeTruthy();
  expect(screen.queryByText('Плановая тренировка')).toBeNull();
  expect(screen.queryByText('Выполнение')).toBeNull();
  act(() => (navigation.mock.calls.at(-1)?.[0] as NavigationContext).onBack?.());
  expect(back).toHaveBeenCalledOnce();
});

it('uses the canonical program destination and unsubscribes when leaving', () => {
  const view = render(<DiscussionEntity thread={thread} role="coach" onBack={vi.fn()} onNavigationContextChange={vi.fn()} />);
  act(() => state.next?.({ kind: 'program', id: 'canonical-plan-id' }));
  expect(screen.getByText('Программа canonical-plan-id')).toBeTruthy();
  view.unmount();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});

it('offers the existing retry action when the authorized reader fails', () => {
  render(<DiscussionEntity thread={thread} role="client" onBack={vi.fn()} onNavigationContextChange={vi.fn()} />);
  act(() => state.fail?.());
  expect(screen.getByRole('alert').textContent).toBe('Не удалось открыть сущность');
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  expect(screen.queryByText('Выполнение')).toBeNull();
});

it('forwards the exact scheduled exercise and set to the existing PLAN viewer', () => {
  const draft: LocalWorkoutOccurrenceDraft = {
    id: 'draft:occurrence', actorUserId: 'tg:11', realmId: 'tg:11',
    athleteUserId: 'tg:11', coachUserId: null, clientUserId: null,
    format: 'independent', startsAtUtc: '2026-11-07T10:00:00.000Z', durationMinutes: 60,
    plan: { name: 'План', comment: null, exercises: [] },
    originalPlan: { name: 'План', comment: null, exercises: [] },
    createdAt: '', updatedAt: '',
  };
  render(<DiscussionEntity thread={thread} role="coach" onBack={vi.fn()} onNavigationContextChange={vi.fn()} />);
  act(() => state.next?.({ kind: 'occurrence', draft, focus: { exerciseId: 'occ-ex', setId: 'occ-set' } }));
  expect(screen.getByText('Плановая тренировка')).toBeTruthy();
  expect(screen.getByTestId('planned-focus').textContent).toBe('occ-ex/occ-set');
});
