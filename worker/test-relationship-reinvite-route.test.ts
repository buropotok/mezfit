import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { validateTelegramInitData } from './lib/telegram';
import { provisionInviteMembership, requireCloudMembershipConfiguration } from './lib/dexie-cloud-membership';
import { resetTestCloudRelationship } from './lib/test-relationship-reset';
import { resetLegacyTestRelationship } from './lib/test-legacy-relationship-reset';

vi.mock('./lib/telegram', async original => ({
  ...(await original<typeof import('./lib/telegram')>()),
  validateTelegramInitData: vi.fn(),
}));
vi.mock('./lib/dexie-cloud-membership', async original => ({
  ...(await original<typeof import('./lib/dexie-cloud-membership')>()),
  provisionInviteMembership: vi.fn(),
  requireCloudMembershipConfiguration: vi.fn(),
}));
vi.mock('./lib/test-relationship-reset', () => ({ resetTestCloudRelationship: vi.fn() }));
vi.mock('./lib/test-legacy-relationship-reset', () => ({ resetLegacyTestRelationship: vi.fn() }));

const telegram = vi.mocked(validateTelegramInitData);
const provision = vi.mocked(provisionInviteMembership);
const resetCloud = vi.mocked(resetTestCloudRelationship);
const resetLegacy = vi.mocked(resetLegacyTestRelationship);
const inviteParam = 'invite_' + 'a'.repeat(36);

beforeEach(() => {
  telegram.mockReset();
  provision.mockReset();
  resetCloud.mockReset();
  resetLegacy.mockReset();
  vi.mocked(requireCloudMembershipConfiguration).mockReset();
  provision.mockResolvedValue({ realmId: 'rlm-pair' });
  resetCloud.mockResolvedValue({ realmId: 'rlm-pair' });
});

describe('reinvite after test connection reset', () => {
  it('accepts the same reusable invite again with the same signed identities', async () => {
    let actor: 'coach' | 'client' = 'client', active = false;
    const coach = { id: 1, telegram_user_id: '101', first_name: 'Coach', last_name: null,
      username: null, language_code: null, photo_url: null, is_premium: 0 };
    const client = { ...coach, id: 2, telegram_user_id: '202', first_name: 'Client' };
    const invite = { id: 51, coach_user_id: 1, coach_telegram_user_id: '101',
      label: null, expires_at: '2030-01-01T00:00:00Z', coach_first_name: 'Coach',
      coach_last_name: null, coach_username: null };
    const prepare = vi.fn((sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id')) {
            return actor === 'coach' ? coach : client;
          }
          if (sql.includes('FROM coach_client_invite i')) {
            return invite;
          }
          if (sql.includes('FROM coach_client cc')) return active ? { id: 2 } : null;
          throw Error('Unexpected first query');
        },
        all: async () => {
          if (sql.includes('SELECT role FROM user_role')) return { results: [{ role: actor }] };
          throw Error('Unexpected all query');
        },
      }),
    }));
    const db = {
      prepare,
      batch: vi.fn(async () => { active = true; return []; }),
    } as unknown as D1Database;
    const env = { TELEGRAM_BOT_TOKEN: 'test', TEST_CONNECTION_RESET_COACH_IDS: '101',
      DB_BINDING: db, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    resetLegacy.mockImplementation(async () => { active = false; });
    const login = () => {
      const user = actor === 'coach' ? coach : client;
      telegram.mockResolvedValue({ user: { id: Number(user.telegram_user_id), first_name: user.first_name },
        authDate: new Date(), startParam: actor === 'client' ? inviteParam : undefined });
    };
    const call = (path: string, method = 'POST') => worker.fetch(new Request('https://mezfit.test' + path, {
      method, headers: { 'x-telegram-init-data': 'signed',
        'x-mezfit-invite-start-param': inviteParam },
    }), env);

    login();
    expect((await call('/api/invite/current/accept')).status).toBe(200);
    expect(active).toBe(true);

    actor = 'coach'; login();
    expect((await call('/api/coach/clients/202/test-relationship', 'DELETE')).status).toBe(200);
    expect(active).toBe(false);

    actor = 'client'; login();
    expect((await call('/api/invite/current', 'GET')).status).toBe(200);
    expect((await call('/api/invite/current/accept')).status).toBe(200);
    expect(active).toBe(true);
    expect(provision).toHaveBeenCalledTimes(2);
    expect(resetCloud).toHaveBeenCalledTimes(1);
    expect(resetLegacy).toHaveBeenCalledTimes(1);
    expect(provision).toHaveBeenNthCalledWith(2, env, '101', '202', expect.any(Function),
      { coach: 'Coach', client: 'Client' });
  });
});
