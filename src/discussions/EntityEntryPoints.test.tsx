// @vitest-environment jsdom
import { cloneElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { EntityDiscussionTarget } from './entity-discussion-target';
import { CloudProgramsPage } from '../program/CloudProgramsPage';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import { OccurrenceDraftCard } from '../schedule/OccurrenceDraftSheet';

const probe = vi.hoisted(() => ({ targets: [] as Array<EntityDiscussionTarget | null>,
  open: vi.fn(), presentation: vi.fn() }));
vi.mock('./useEntityDiscussions', () => ({ useEntityDiscussions: (target: EntityDiscussionTarget | null) => {
  probe.targets.push(target);
  return { open: probe.open, canOpen: true, unread: target ? 4 : 0, content: null, onMenuPresentationChange: probe.presentation,
    menuItem: { id: 'discussions', label: 'Обсуждения', unreadCount: 4, onSelect: probe.open } };
} }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: {}, actorUserId: 'tg:11', clients: [], coaches: [],
}) }));
vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  LiquidPopover: (props: LiquidPopoverProps) => <>
    {cloneElement(props.trigger, { onClick: () => props.onOpenChange(!props.isOpen) })}
    {props.isOpen && <div role="menu">{props.items?.map(item => <button role="menuitem" key={item.id}
      onClick={() => { item.onSelect?.(); props.onOpenChange(false); props.onPresentationChange?.(false); }}>{item.label}</button>)}</div>}
  </>,
}));
vi.mock('../program/ProgramSummary', () => ({ ProgramSummary: ({ discussionAction }: { discussionAction?: ReactNode }) => <>{discussionAction}</> }));
vi.mock('../program/PlanSyncNotice', () => ({ PlanSyncNotice: () => null }));
vi.mock('../ui/SpotlightHint', async original => ({
  ...await original<typeof import('../ui/SpotlightHint')>(),
  SpotlightHint: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../schedule/WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../schedule/WorkoutPerson', () => ({ useWorkoutPerson: () => ({ name: 'Участник', avatar: null }) }));
vi.mock('../ui/WorkoutRepeatControl', () => ({ WorkoutRepeatControl: () => null }));
vi.mock('../workout/WorkoutPlanCard', () => ({ WorkoutPlanCard: () => null,
  WorkoutPlanCardHeader: ({ children }: { children: ReactNode }) => <>{children}</> }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); probe.targets.splice(0); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const program = { id: 'program', realmId: 'pair', owner: null, coachUserId: 'tg:11', clientUserId: 'tg:22',
  name: 'Силовая', position: 0, status: 'active' as const, startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' };
const plan = { name: 'Тренировка', comment: 'Предписание', exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:occurrence', actorUserId: 'tg:11', realmId: 'pair',
  coachUserId: 'tg:11', clientUserId: 'tg:22', athleteUserId: 'tg:22', format: 'coached',
  startsAtUtc: '2026-11-07T10:00:00.000Z', durationMinutes: 60, plan, originalPlan: plan,
  saved: true, executionStatus: 'scheduled', createdAt: '', updatedAt: '' };

describe('COMM-06 production surface wiring', () => {
  it.each(['coach', 'client'] as const)('exposes only a program root entry for %s, including read-only assigned PLAN', async role => {
    const details = { program, phases: [], days: [] };
    const observe = vi.fn((_id: string, next: (value: typeof details) => void) => { next(details); return { unsubscribe: vi.fn() }; });
    const repository = { actorUserId: role === 'coach' ? 'tg:11' : 'tg:22', observeDetails: observe, observeAthleteDetails: observe };
    render(<CloudProgramDetailsPage repository={repository as unknown as ProgramManagementRepository} planId="program"
      viewerRole={role} readOnly={role === 'client'} cloudStatus="ready" cloudError="" syncStatus="offline" syncError=""
      onRetryCloud={async () => {}} onRetrySync={async () => {}} onNavigationContextChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Обсуждения' }));
    expect(screen.queryByRole('button', { name: 'Меню программы' })).toBeNull();
    expect(probe.open).toHaveBeenCalledOnce();
    expect(probe.targets.at(-1)).toMatchObject({ anchor: { kind: 'program', trainingPlanId: 'program' },
      scope: { realmId: 'pair', coachClientId: 'pair' } });
    expect(screen.getByLabelText('Непрочитанных: 4')).toBeTruthy();
  });
  it.each(['coach', 'client'] as const)('keeps the program list actions and opens the same program/pair for %s', async role => {
    const observe = (next: (rows: typeof program[]) => void) => { next([program]); return { unsubscribe: vi.fn() }; };
    const repository = { actorUserId: role === 'coach' ? 'tg:11' : 'tg:22', observeAuthored: observe, observeForAthlete: observe };
    render(<CloudProgramsPage repository={repository as unknown as ProgramManagementRepository}
      clients={[]} coaches={[]} onOpen={vi.fn()} viewerRole={role} cloudStatus="ready" cloudError=""
      syncStatus="offline" syncError="" onRetryCloud={async () => {}} onRetrySync={async () => {}}
      onNavigationContextChange={vi.fn()} />);
    expect(await screen.findByLabelText('Непрочитанных: 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Меню программы Силовая' }));
    expect(Boolean(screen.queryByRole('menuitem', { name: 'Переименовать' }))).toBe(role === 'coach');
    expect(Boolean(screen.queryByRole('menuitem', { name: 'Дублировать' }))).toBe(role === 'coach');
    expect(Boolean(screen.queryByRole('menuitem', { name: 'Удалить' }))).toBe(role === 'coach');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Обсуждения' }));
    expect(probe.open).toHaveBeenCalledOnce();
    expect(probe.presentation).toHaveBeenCalledWith(false);
    expect(probe.targets.at(-1)).toMatchObject({ anchor: { kind: 'program', trainingPlanId: 'program' },
      scope: { realmId: 'pair', coachClientId: 'pair' } });
  });
  it('opens the same planned-workout discussion from the direct icon without using the menu', () => {
    const drafts = { repeatStateFor: vi.fn(async () => ({ rule: null, applied: false })), pendingEditError: () => '' };
    render(<OccurrenceDraftCard draft={draft}
      drafts={drafts as unknown as WorkoutOccurrenceDraftRepository}
      readOnly collapsed={false} onCollapsedChange={vi.fn()}
      onClose={vi.fn()} onSave={async () => {}} onNavigationContextChange={vi.fn()} />);
    const icon = screen.getByRole('button', { name: 'Обсуждения' });
    expect(icon.closest('.occurrence-draft-sheet__discussion-action')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Меню тренировки' })).toBeTruthy();
    expect(screen.getByLabelText('Непрочитанных: 4')).toBeTruthy();
    fireEvent.click(icon);
    expect(probe.open).toHaveBeenCalledOnce();
    expect(probe.targets.at(-1)?.anchor).toEqual({ kind: 'workout', workout: { kind: 'occurrence', id: 'occurrence' } });
  });

  it('retains the canonical planned-workout entry after execution', () => {
    const drafts = { repeatStateFor: vi.fn(async () => ({ rule: null, applied: false })), pendingEditError: () => '' };
    const page = (source: LocalWorkoutOccurrenceDraft) => <OccurrenceDraftCard draft={source}
      drafts={drafts as unknown as WorkoutOccurrenceDraftRepository} readOnly collapsed={false} onCollapsedChange={vi.fn()}
      onClose={vi.fn()} onSave={async () => {}} onNavigationContextChange={vi.fn()} />;
    const view = render(page(draft));
    fireEvent.click(screen.getByRole('button', { name: 'Меню тренировки' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Обсуждения' }));
    expect(probe.targets.at(-1)?.anchor).toEqual({ kind: 'workout', workout: { kind: 'occurrence', id: 'occurrence' } });
    expect(probe.open).toHaveBeenCalledOnce();
    view.rerender(page({ ...draft, executionStatus: 'completed', workoutSessionId: 'session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Меню тренировки' }));
    expect(screen.getByRole('menuitem', { name: 'Обсуждения' })).toBeTruthy();
    expect(probe.targets.at(-1)?.anchor).toEqual({ kind: 'workout', workout: { kind: 'occurrence', id: 'occurrence' } });
  });
});
