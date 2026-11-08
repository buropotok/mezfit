// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getMe, type MeResponse } from './api';
import { App } from './App';
import { readConfirmedAccount, saveConfirmedAccount } from './appSessionCache';

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(), getMe: vi.fn(),
}));

function Pass({ children }: { children: ReactNode }) { return <>{children}</>; }
vi.mock('./profile/UserProfileNavigationShell', () => ({
  UserProfileNavigationShell: ({ children }: { children: ReactNode }) => <div data-testid="local-workspace">{children}</div>,
}));
vi.mock('./coach/CoachShell', () => ({ CoachShell: () => <div>Локальное расписание тренера</div> }));
vi.mock('./data/cloud/CloudConnectionsProvider', () => ({ CloudConnectionsProvider: Pass }));
vi.mock('./profile/UserProfilePublicationProvider', () => ({ UserProfilePublicationProvider: Pass }));
vi.mock('./exercises/PublicCategoryArtworkProvider', () => ({ PublicCategoryArtworkProvider: Pass }));
vi.mock('./workout/ClientWorkoutContext', () => ({ ClientWorkoutProvider: Pass }));
vi.mock('./client/ClientCoachContext', () => ({
  ClientCoachProvider: Pass, useClientCoach: () => ({ refreshCoaches: vi.fn(), selectedCoach: null }),
}));
vi.mock('./data/cloud/AssignedProgramsProvider', () => ({ AssignedProgramsProvider: Pass }));
vi.mock('./workout/PlannedWorkoutStartContext', () => ({ PlannedWorkoutStartProvider: Pass }));
vi.mock('./workout/WorkoutCompletionContext', () => ({ WorkoutCompletionProvider: Pass }));
vi.mock('./discussions/DiscussionsProvider', () => ({ DiscussionsProvider: Pass }));
vi.mock('./homeScreen/HomeScreenInstallToast', () => ({ HomeScreenInstallToast: () => null }));
vi.mock('./exercises/PublicExerciseMediaPrefetch', () => ({ PublicExerciseMediaPrefetch: () => null }));
vi.mock('./workout/WorkedMuscleAssetsPrefetch', () => ({ WorkedMuscleAssetsPrefetch: () => null }));
vi.mock('./ui', () => ({
  GlassSurfaceProvider: Pass,
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const signed = new URLSearchParams({
  user: JSON.stringify({ id: 101 }), auth_date: '1794142800', hash: 'a'.repeat(64),
}).toString();
const me: MeResponse = { user: {
  id: 17, telegramUserId: '101', username: null, firstName: 'Тренер',
  lastName: null, languageCode: 'ru', photoUrl: null, isPremium: false,
}, roles: ['coach'] };
const getMeMock = vi.mocked(getMe);
function deferred() {
  let resolve!: (value: MeResponse) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<MeResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.localStorage.clear();
  getMeMock.mockReset();
  window.Telegram = { WebApp: {
    initData: signed, colorScheme: 'dark', ready: vi.fn(), expand: vi.fn(),
  } };
});
afterEach(() => {
  cleanup(); window.localStorage.clear(); delete window.Telegram;
});

describe('reopen Mezfit from a confirmed local account', () => {
  it('renders the local workspace before /api/me resolves', async () => {
    saveConfirmedAccount(signed, me);
    const remote = deferred();
    getMeMock.mockReturnValue(remote.promise);
    render(<App />);
    expect(await screen.findByText('Локальное расписание тренера')).toBeTruthy();
    expect(getMeMock).toHaveBeenCalledWith(signed);
    await act(async () => { remote.reject(new Error('OFFLINE')); await remote.promise.catch(() => undefined); });
    expect(screen.getByText('Локальное расписание тренера')).toBeTruthy();
  });

  it('shows first-login pending state without a previously confirmed account', () => {
    const remote = deferred();
    getMeMock.mockReturnValue(remote.promise);
    render(<App />);
    expect(screen.getByText('Подключаем Mezfit…')).toBeTruthy();
    expect(screen.queryByTestId('local-workspace')).toBeNull();
  });

  it('revokes local presentation after an explicit 401 from the Worker', async () => {
    saveConfirmedAccount(signed, me);
    const remote = deferred();
    getMeMock.mockReturnValue(remote.promise);
    render(<App />);
    expect(await screen.findByTestId('local-workspace')).toBeTruthy();
    await act(async () => { remote.reject(new ApiError(401, 'Сеанс отклонён')); await remote.promise.catch(() => undefined); });
    expect(screen.queryByTestId('local-workspace')).toBeNull();
    expect(readConfirmedAccount(signed)).toBeNull();
    expect(screen.getByText('Сеанс отклонён')).toBeTruthy();
  });

  it('persists a verified live profile for the next launch', async () => {
    getMeMock.mockResolvedValue(me);
    render(<App />);
    await waitFor(() => expect(readConfirmedAccount(signed)).toEqual(me));
    expect(screen.getByText('Локальное расписание тренера')).toBeTruthy();
  });
  it('rejects a mismatched live account instead of switching the local database identity', async () => {
    saveConfirmedAccount(signed, me);
    getMeMock.mockResolvedValue({ ...me, user: { ...me.user, telegramUserId: '202' } });
    render(<App />);
    expect(await screen.findByText('Некорректный ответ авторизации Telegram.')).toBeTruthy();
    expect(readConfirmedAccount(signed)).toBeNull();
    expect(screen.queryByTestId('local-workspace')).toBeNull();
  });
});
