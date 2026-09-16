import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWorkoutSessionRoute } from './lib/workout-session-api';
import { validateTelegramInitData } from './lib/telegram';
import worker from './index';

vi.mock('./lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/telegram')>();
  return {
    ...actual,
    validateTelegramInitData: vi.fn(),
  };
});

vi.mock('./lib/workout-session-api', () => ({
  handleWorkoutSessionRoute: vi.fn(),
}));

const validateMock = vi.mocked(validateTelegramInitData);
const workoutRouteMock = vi.mocked(handleWorkoutSessionRoute);

const userRow = {
  id: 7,
  telegram_user_id: '700',
  username: null,
  first_name: 'Coach',
  last_name: null,
  language_code: 'ru',
  photo_url: null,
  is_premium: 0,
};

function createEnv(roles: Array<'coach' | 'client'>): Env {
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id = ?')) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(userRow),
        }),
      };
    }
    if (sql === 'SELECT role FROM user_role WHERE user_id = ? ORDER BY role') {
      return {
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: roles.map((role) => ({ role })) }),
        }),
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  return {
    DB_BINDING: { prepare } as unknown as D1Database,
    TELEGRAM_BOT_TOKEN: 'test-token',
    ASSETS: { fetch: vi.fn() },
  } as unknown as Env;
}

beforeEach(() => {
  validateMock.mockReset();
  workoutRouteMock.mockReset();
  validateMock.mockResolvedValue({
    user: { id: 700, first_name: 'Coach' },
    authDate: new Date('2026-09-16T12:00:00Z'),
  });
  workoutRouteMock.mockResolvedValue(new Response(JSON.stringify({ session: { sessionId: 501, status: 'draft' } }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  }));
});

describe('workout API access', () => {
  it.each([
    ['coach-only user', ['coach'] as Array<'coach' | 'client'>],
    ['coach + client user', ['coach', 'client'] as Array<'coach' | 'client'>],
  ])('allows an authenticated %s to initialize their own workout session', async (_label, roles) => {
    const env = createEnv(roles);
    const request = new Request('https://mezfit.test/api/workout-sessions/initialize', {
      method: 'POST',
      headers: { 'x-telegram-init-data': 'telegram-init' },
      body: JSON.stringify({}),
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(201);
    expect(workoutRouteMock).toHaveBeenCalledTimes(1);
    expect(workoutRouteMock).toHaveBeenCalledWith(request, env.DB_BINDING, userRow.id);
  });
});
