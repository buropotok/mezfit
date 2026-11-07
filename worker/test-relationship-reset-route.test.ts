import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { validateTelegramInitData } from './lib/telegram';
import { resetTestCloudRelationship } from './lib/test-relationship-reset';

vi.mock('./lib/telegram', async original => ({
  ...(await original<typeof import('./lib/telegram')>()),
  validateTelegramInitData: vi.fn(),
}));
vi.mock('./lib/test-relationship-reset', () => ({ resetTestCloudRelationship: vi.fn() }));

const telegram = vi.mocked(validateTelegramInitData);
const reset = vi.mocked(resetTestCloudRelationship);
const coach = { id: 1, telegram_user_id: '101', first_name: 'Coach', last_name: null,
  username: null, language_code: null, photo_url: null, is_premium: 0 };

function fixture() {
  let active = true, failD1 = false, role: 'coach' | 'client' = 'coach';
  const prepare = vi.fn((sql: string) => ({
    bind: (..._args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id')) return coach;
        if (sql.includes('FROM coach_client cc')) return active ? { id: 2 } : null;
        throw Error('Unexpected first query');
      },
      all: async () => {
        if (sql.includes('SELECT role FROM user_role')) return { results: [{ role }] };
        throw Error('Unexpected all query');
      },
      run: async () => {
        if (failD1) throw Error('D1 unavailable');
        active = false;
        return { success: true };
      },
    }),
  }));
  const env = {
    TELEGRAM_BOT_TOKEN: 'test', TEST_CONNECTION_RESET_COACH_IDS: '101,999',
    DB_BINDING: { prepare } as unknown as D1Database,
    ASSETS: { fetch: vi.fn() },
  } as unknown as Env;
  const request = (clientId = '202') => new Request(
    'https://mezfit.test/api/coach/clients/' + clientId + '/test-relationship',
    { method: 'DELETE', headers: { 'x-telegram-init-data': 'signed' } },
  );
  return { env, request, prepare, active: () => active, failD1: () => { failD1 = true; }, setRole: (next: 'coach' | 'client') => { role = next; } };
}

beforeEach(() => {
  telegram.mockReset();
  reset.mockReset();
  telegram.mockResolvedValue({ user: { id: 101, first_name: 'Coach' }, authDate: new Date(), startParam: undefined });
  reset.mockResolvedValue({ realmId: 'rlm-test' });
});

describe('signed Coach test reset route', () => {
  it('checks the pair, clears cloud first and then deactivates only that D1 link', async () => {
    const f = fixture();
    reset.mockImplementation(async () => {
      expect(f.active()).toBe(true);
      return { realmId: 'rlm-test' };
    });
    const response = await worker.fetch(f.request(), f.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(reset).toHaveBeenCalledWith(f.env, '101', '202', expect.any(Function));
    expect(f.active()).toBe(false);
    expect((await worker.fetch(f.request(), f.env)).status).toBe(404);
  });

  it('does not reach cloud for an unapproved coach or malformed target', async () => {
    const f = fixture();
    const restricted = { ...f.env, TEST_CONNECTION_RESET_COACH_IDS: '999' };
    expect((await worker.fetch(f.request(), restricted)).status).toBe(403);
    expect((await worker.fetch(f.request('9007199254740992'), f.env)).status).toBe(400);
    expect(reset).not.toHaveBeenCalled();
  });

  it('keeps D1 active if cloud cleanup fails, allowing a retry', async () => {
    const f = fixture();
    reset.mockRejectedValueOnce(new Error('offline'));
    expect((await worker.fetch(f.request(), f.env)).status).toBe(500);
    expect(f.active()).toBe(true);
    expect((await worker.fetch(f.request(), f.env)).status).toBe(200);
    expect(f.active()).toBe(false);
  });

  it('fails closed for a user without the Coach role', async () => {
    const f = fixture();
    telegram.mockResolvedValue({ user: { id: 202, first_name: 'Client' }, authDate: new Date(), startParam: undefined });
    f.setRole('client');
    expect((await worker.fetch(f.request(), f.env)).status).toBe(403);
    expect(reset).not.toHaveBeenCalled();
  });
});
