// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachAdHocWorkoutsScreen } from './CoachAdHocWorkoutsScreen';

const state = vi.hoisted(() => ({ syncStatus: 'synced' as 'synced' | 'offline' | 'error' }));
const db = {};

vi.mock('../NavigationShell', () => ({
  useNavigationFloatingAction: () => {},
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db, actorUserId: 'tg:101', syncStatus: state.syncStatus }),
}));
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    observeOpen(onChange: (rows: []) => void) {
      onChange([]);
      return { unsubscribe: () => {} };
    }
  },
}));
vi.mock('konsta/react', () => ({
  List: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title }: { title: string }) => <div>{title}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  Toast: () => null,
}));
vi.mock('../ui', () => ({
  Text: ({ children, role }: { children?: ReactNode; role?: string }) => <span role={role}>{children}</span>,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
  MezfitBottomSheet: () => null,
}));
vi.mock('../schedule/ScheduleWorkoutCreator', () => ({ ScheduleWorkoutCreator: () => null }));
vi.mock('./AdHocSessionScreen', () => ({ AdHocSessionScreen: () => null }));

afterEach(cleanup);

describe('Coach training sync feedback', () => {
  it('does not claim changes are waiting when Dexie reports offline without an error', () => {
    state.syncStatus = 'offline';
    render(<CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={() => {}} />);
    expect(screen.queryByText(/Изменения ожидают синхронизации/)).toBeNull();
    expect(screen.queryByText(/Нет соединения с Mezfit облаком/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a genuine synchronization error visible', () => {
    state.syncStatus = 'error';
    render(<CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Не удалось синхронизировать данные с Mezfit облаком.');
  });

  it('does not show a warning when Dexie reports synced', () => {
    state.syncStatus = 'synced';
    render(<CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Mezfit облаком/)).toBeNull();
  });
});
