// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MeResponse } from '../api';
import { UserProfileNavigationShell } from './UserProfileNavigationShell';

const probes = vi.hoisted(() => ({
  programs: vi.fn(),
  exercises: vi.fn(),
}));
const cloudDatabase = {};
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: cloudDatabase, actorUserId: 'tg:202' }),
}));
vi.mock('../data/cloud/user-profile', () => ({ UserProfileRepository: class {
  constructor(_db: unknown, readonly actorUserId: string) {}
  observeOwn(next: (profile: null) => void) {
    next(null);
    return { unsubscribe: vi.fn() };
  }
  migrateOwn() { return Promise.resolve(); }
} }));
vi.mock('../workout/ClientWorkoutContext', () => ({
  ClientWorkoutNavigationShell: ({ children, context }: { children: ReactNode; context?: { onBack?: () => void } | null }) =>
    <main>{context?.onBack ? <button onClick={context.onBack}>Назад к упражнениям</button> : null}{children}</main>,
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { value: string; label: string }[];
    value: string;
    onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map(item =>
    <button type="button" role="tab" key={item.value} aria-selected={item.value === value}
      onClick={() => onValueChange(item.value)}>{item.label}</button>)}</div>,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock('./UserProfileForm', () => ({ UserProfileForm: () => <span>Анкета</span> }));
vi.mock('./UserAvatarEditor', () => ({ UserAvatarEditor: () => null }));
vi.mock('./UserProfilePublicationProvider', () => ({ UserProfileSyncStatus: () => null }));
vi.mock('./ProfileWorkoutTimeline', () => ({ ProfileWorkoutTimeline: () => null }));
vi.mock('../client/ClientProgramsPage', () => ({
  ClientProgramsPage: (props: { activeOnly?: boolean }) => {
    probes.programs(props);
    return <section aria-label="Каталог программ клиента">Все статусы</section>;
  },
}));
vi.mock('./ProfilePerformedExercisesPage', () => ({
  ClientPerformedExercisesPage: (props: {
    client?: { userId: string };
    onDetailNavigationChange?: (value: { title: string; onBack: () => void } | null) => void;
  }) => {
    probes.exercises(props);
    return <section aria-label="Выполненные упражнения клиента">Все личные и тренерские FACT
      <button onClick={() => props.onDetailNavigationChange?.({
        title: 'Статистика жима', onBack: () => props.onDetailNavigationChange?.(null),
      })}>Открыть статистику</button>
    </section>;
  },
}));

const me: MeResponse = {
  user: { id: 202, telegramUserId: '202', firstName: 'Анна', lastName: null,
    username: null, photoUrl: null, languageCode: 'ru', isPremium: false },
  roles: ['client'],
};

afterEach(() => { cleanup(); probes.programs.mockClear(); probes.exercises.mockClear(); });

it('duplicates the unrestricted Client Programs page and opens the shared self exercise page', () => {
  render(<UserProfileNavigationShell me={me} activeRole="client" destination="profile"
    context={null} onDestinationChange={vi.fn()} onRoleSwitch={vi.fn()}>
    <span>Экран клиента</span>
  </UserProfileNavigationShell>);
  fireEvent.click(screen.getByRole('tab', { name: 'Программа' }));
  expect(screen.getByRole('region', { name: 'Каталог программ клиента' })).toBeTruthy();
  expect(probes.programs).toHaveBeenCalled();
  expect(probes.programs.mock.lastCall?.[0].activeOnly).toBeUndefined();

  fireEvent.click(screen.getByRole('tab', { name: 'Упражнения' }));
  expect(screen.getByRole('region', { name: 'Выполненные упражнения клиента' })).toBeTruthy();
  expect(probes.exercises).toHaveBeenCalled();
  expect(probes.exercises.mock.lastCall?.[0].client).toBeUndefined();
  expect(screen.queryByText('Все статусы')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }));
  expect(screen.queryByRole('tab', { name: 'Программа' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Назад к упражнениям' }));
  expect(screen.getByRole('tab', { name: 'Упражнения' })).toBeTruthy();
});
