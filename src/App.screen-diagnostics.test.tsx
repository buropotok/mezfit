// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe, getCurrentWorkoutSession } from './api';
import { App } from './App';
import { SCREEN_DIAGNOSTICS_DEEP_LINK } from './settings/screenDiagnosticsRoute';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, getMe: vi.fn(), getCurrentWorkoutSession: vi.fn() };
});

vi.mock('./NavigationShell', () => ({
  NavigationShell: ({ children, destination }: { children: ReactNode; destination: string }) => (
    <div>
      <span data-testid="destination">{destination}</span>
      {children}
    </div>
  ),
}));
vi.mock('./data/cloud/CloudConnectionsProvider', () => ({
  CloudConnectionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./data/cloud/AssignedProgramsProvider', () => ({
  AssignedProgramsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./client/ClientCoachContext', () => ({
  ClientCoachProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClientCoach: () => ({ selectedCoach: null, refreshCoaches: vi.fn() }),
}));
vi.mock('./exercises/PublicExerciseMediaPrefetch', () => ({
  PublicExerciseMediaPrefetch: () => null,
}));
vi.mock('./workout/WorkedMuscleAssetsPrefetch', () => ({
  WorkedMuscleAssetsPrefetch: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/?tgWebAppStartParam=screen_diagnostics');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.mocked(getMe).mockReset();
  vi.mocked(getCurrentWorkoutSession).mockReset();
  vi.mocked(getCurrentWorkoutSession).mockResolvedValue({ session: null });
  vi.mocked(getMe).mockResolvedValue({
    user: {
      id: 10,
      telegramUserId: '100',
      username: 'client',
      firstName: 'Клиент',
      lastName: null,
      languageCode: 'ru',
      photoUrl: null,
      isPremium: false,
    },
    roles: ['client'],
  });
  window.Telegram = {
    WebApp: {
      initData: 'telegram-init',
      initDataUnsafe: { start_param: 'screen_diagnostics' },
      colorScheme: 'dark',
      ready: vi.fn(),
      expand: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  delete window.Telegram;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('screen diagnostics Main Mini App deep link', () => {
  it('navigates directly into Settings diagnostics after Telegram authorization', async () => {
    render(<App />);

    expect(await screen.findByRole('region', { name: 'Диагностика экрана' })).toBeTruthy();
    expect(screen.getByTestId('destination').textContent).toBe('settings');
    expect(screen.getByText(SCREEN_DIAGNOSTICS_DEEP_LINK)).toBeTruthy();
    expect(getMe).toHaveBeenCalledWith('telegram-init');
  });
});
