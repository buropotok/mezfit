// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CalendarSessionSheet } from './CalendarSessionSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: database, actorUserId: 'tg:202' }) }));
const database = {};
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class {} }));
vi.mock('../workout/AdHocSessionScreen', () => ({ AdHocSessionScreen: ({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) => <div data-testid="session" data-readonly={String(readOnly)}>{sessionId}</div> }));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  IconButton: () => null,
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
}));
afterEach(cleanup);
it.each(['coach', 'client'] as const)('opens the exact session with %s capabilities', role => {
  render(<CalendarSessionSheet sessionId="completed-history-id" role={role} initData="" onClose={() => {}} onNavigationContextChange={() => {}} />);
  expect(screen.getByTestId('session').textContent).toBe('completed-history-id');
  expect(screen.getByTestId('session').getAttribute('data-readonly')).toBe(String(role === 'client'));
});
