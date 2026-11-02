// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile, UserProfileDraft } from '../data/cloud/user-profile';
import type { AppDestination, NavigationContext } from '../NavigationShell';
import type { MeResponse, Role } from '../api';
import { UserProfileNavigationShell } from './UserProfileNavigationShell';

const state = vi.hoisted(() => ({ actor: 'tg:202', db: {}, profile: null as UserProfile | null,
  listeners: new Map<string, { next: (value: UserProfile | null) => void; error: () => void }>(),
  save: vi.fn<(draft: UserProfileDraft) => Promise<UserProfile>>(), migrationFails: false,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: state.actor }),
}));
vi.mock('../data/cloud/user-profile', () => ({ UserProfileRepository: class {
  constructor(_db: unknown, readonly actorUserId: string) {}
  async migrateOwn() { if (state.migrationFails) throw new Error('IndexedDB read failed'); }
  observeOwn(next: (value: UserProfile | null) => void, error: () => void) {
    state.listeners.set(this.actorUserId, { next, error }); next(state.profile);
    return { unsubscribe: () => state.listeners.delete(this.actorUserId) };
  }
  saveOwn(draft: UserProfileDraft) { return state.save(draft); }
} }));
vi.mock('../workout/ClientWorkoutContext', () => ({
  ClientWorkoutNavigationShell: ({ children, destination, registrationRequired, onDestinationChange, context }: {
    children: ReactNode; destination: string; registrationRequired?: boolean;
    onDestinationChange: (next: AppDestination) => void; context?: NavigationContext | null;
  }) => <><span data-testid="destination">{destination}</span><span data-testid="locked">{String(registrationRequired)}</span>
    <button onClick={() => onDestinationChange('training')}>Таб тренировки</button>
    <button onClick={() => context?.onBack?.()}>Назад</button>{children}</>,
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { value: string; label: string }[]; value: string; onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map(tab => <button key={tab.value} role="tab" aria-selected={value === tab.value}
    onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</div>,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock('./UserProfileForm', () => ({
  UserProfileForm: ({ initialProfile, onSave }: { initialProfile: UserProfile | null; onSave: (draft: UserProfileDraft) => Promise<void> }) => {
    const [name, setName] = useState(initialProfile?.firstName ?? '');
    return <><input aria-label="Имя" value={name} onChange={event => setName(event.target.value)} />
      <button onClick={() => { void onSave({ firstName: name, lastName: '', email: '', phone: '',
        birthDate: '2000-01-01', sex: 'undisclosed', weightKg: null }); }}>Сохранить</button></>;
  },
}));
const me: MeResponse = { user: { id: 202, telegramUserId: '202', firstName: 'Анна', lastName: null,
  username: 'anna_fit', photoUrl: null, languageCode: 'ru', isPremium: false }, roles: ['client', 'coach'] };
const saved: UserProfile = { firstName: 'Анна', lastName: '', email: '', phone: '',
  birthDate: '2000-01-01', sex: 'undisclosed', weightKg: null, updatedAt: '2026-11-02T00:00:00Z' };
function Harness({ role = 'client', user = me }: { role?: Role; user?: MeResponse }) {
  const [destination, setDestination] = useState<AppDestination>('today');
  return <UserProfileNavigationShell me={user} activeRole={role} destination={destination}
    context={null} onDestinationChange={setDestination} onRoleSwitch={() => {}}><span>Обычный экран</span></UserProfileNavigationShell>;
}
beforeEach(() => {
  state.profile = null; state.actor = 'tg:202'; state.migrationFails = false;
  state.listeners.clear(); state.save.mockReset().mockResolvedValue(saved);
});
afterEach(cleanup);

describe('profile registration navigation', () => {
  it('opens Basics inside My profile and prevents tab/back bypass until local save', async () => {
    render(<Harness />);
    await screen.findByLabelText('Имя');
    expect(screen.getByTestId('destination').textContent).toBe('profile');
    fireEvent.click(screen.getByText('Таб тренировки'));
    fireEvent.click(screen.getByText('Назад'));
    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(screen.queryByText('Обычный экран')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Основные' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('false'));
    expect(screen.getByTestId('destination').textContent).toBe('profile');
    fireEvent.click(screen.getByText('Таб тренировки'));
    expect(screen.getByText('Обычный экран')).toBeTruthy();
  });

  it('does not introduce mandatory registration for a coach', () => {
    render(<Harness role="coach" />);
    expect(screen.getByText('Обычный экран')).toBeTruthy();
    expect(screen.getByTestId('locked').textContent).toBe('false');
  });

  it('keeps the entered registration draft through a read failure and retry', async () => {
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'Черновик' } });
    act(() => state.listeners.get('tg:202')?.error());
    fireEvent.click(screen.getByText('Повторить'));
    await waitFor(() => expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Черновик'));
    expect(screen.getByTestId('locked').textContent).toBe('true');
  });

  it('has a retryable initial read failure instead of a navigation loop', async () => {
    state.migrationFails = true;
    render(<Harness />);
    await screen.findByText('Не удалось загрузить анкету. Попробуйте ещё раз.');
    expect(screen.queryByLabelText('Имя')).toBeNull();
    state.migrationFails = false;
    fireEvent.click(screen.getByText('Повторить'));
    expect(await screen.findByLabelText('Имя')).toBeTruthy();
  });

  it('does not apply an old account save completion after switching accounts', async () => {
    let finish: ((value: UserProfile) => void) | undefined;
    state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'Старый аккаунт' } });
    fireEvent.click(screen.getByText('Сохранить'));
    state.actor = 'tg:303';
    view.rerender(<Harness user={{ ...me, user: { ...me.user, telegramUserId: '303' } }} />);
    await waitFor(() => expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe(''));
    await act(async () => { finish?.(saved); });
    expect(screen.getByTestId('locked').textContent).toBe('true');
    expect(screen.getByTestId('destination').textContent).toBe('profile');
  });
});
