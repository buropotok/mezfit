// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CalendarSessionSheet } from './CalendarSessionSheet';

const cloudActor = vi.hoisted(() => ({ userId: 'tg:202' as string | undefined }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: database, actorUserId: cloudActor.userId }),
}));
const database = {};
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class {} }));
vi.mock('../workout/AdHocSessionScreen', () => ({ AdHocSessionScreen: ({ sessionId, readOnly = false, personalCatalogueRole }: { sessionId: string; readOnly?: boolean; personalCatalogueRole: string }) => <div data-testid="session" data-catalogue-role={personalCatalogueRole} data-readonly={String(readOnly)}>{sessionId}</div> }));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  IconButton: () => null,
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
}));
afterEach(() => { cleanup(); cloudActor.userId = 'tg:202'; });
it.each(['coach', 'client'] as const)('opens the exact session with %s capabilities', role => {
  render(<CalendarSessionSheet sessionId="completed-history-id" role={role} initData="" onClose={() => {}} onNavigationContextChange={() => {}} />);
  expect(screen.getByTestId('session').textContent).toBe('completed-history-id');
  expect(screen.getByTestId('session').getAttribute('data-readonly')).toBe('false');
  expect(screen.getByTestId('session').getAttribute('data-catalogue-role')).toBe(role);
});

it.each([undefined, 'invalid-user-id'])('does not construct a session repository without a valid cloud actor (%s)', actorId => {
  cloudActor.userId = actorId;
  render(<CalendarSessionSheet sessionId="completed-history-id" role="coach" initData=""
    onClose={() => {}} onNavigationContextChange={() => {}} />);
  expect(screen.queryByTestId('session')).toBeNull();
});
