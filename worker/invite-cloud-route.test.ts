import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { validateTelegramInitData } from './lib/telegram';
import {
  CloudMembershipError, provisionInviteMembership, requireCloudMembershipConfiguration,
} from './lib/dexie-cloud-membership';

vi.mock('./lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/telegram')>()),
  validateTelegramInitData: vi.fn(),
}));
vi.mock('./lib/dexie-cloud-membership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/dexie-cloud-membership')>()),
  provisionInviteMembership: vi.fn(),
  requireCloudMembershipConfiguration: vi.fn(),
}));

const identity = vi.mocked(validateTelegramInitData);
const provision = vi.mocked(provisionInviteMembership);
const checkConfiguration = vi.mocked(requireCloudMembershipConfiguration);
const launch = 'invite_' + 'a'.repeat(36);

const client = {
  id: 2, telegram_user_id: '202', username: null,
  first_name: 'Client', last_name: null, language_code: 'ru',
  photo_url: null, is_premium: 0,
};

function fixture() {
  let acceptedBy: number | null = null;
  let linked = false;
  let roles: Array<'coach' | 'client'> = [];
  let failProjection = false;
  const invite = {
    id: 41, coach_user_id: 1, coach_telegram_user_id: '101', label: null,
    expires_at: '2030-01-01T00:00:00Z',
    coach_first_name: 'Coach', coach_last_name: null, coach_username: null,
  };
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id = ?')) {
          return client;
        }
        if (sql.includes('FROM coach_client_invite i')) {
          if (linked || (acceptedBy !== null && acceptedBy !== client.id)) return null;
          return invite;
        }
        if (sql.includes('UPDATE coach_client_invite')) {
          if (args[0] !== client.id || (acceptedBy !== null && acceptedBy !== client.id)) return null;
          acceptedBy = client.id;
          return { id: invite.id };
        }
        throw Error('Unexpected SQL first: ' + sql);
      },
      all: async () => {
        if (sql === 'SELECT role FROM user_role WHERE user_id = ? ORDER BY role') {
          return { results: roles.map((role) => ({ role })) };
        }
        throw Error('Unexpected SQL all: ' + sql);
      },
    }),
  }));
  const batch = vi.fn(async () => {
    if (failProjection) throw Error('D1 unavailable');
    linked = true;
    roles = ['client'];
    return [];
  });
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    DEXIE_CLOUD_CLIENT_ID: 'telegram-id',
    DEXIE_CLOUD_CLIENT_SECRET: 'telegram-secret',
    DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID: 'manager-id',
    DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET: 'manager-secret',
    DB_BINDING: { prepare, batch } as unknown as D1Database,
    ASSETS: { fetch: vi.fn() },
  } as unknown as Env;
  return {
    env, batch, prepare,
    acceptedBy: () => acceptedBy,
    isLinked: () => linked,
    failD1Once: () => { failProjection = true; },
    restoreD1: () => { failProjection = false; },
  };
}

function request(path = '/api/invite/current/accept', method = 'POST'): Request {
  return new Request('https://mezfit.test' + path, {
    method,
    headers: {
      'x-telegram-init-data': 'signed-init-data',
      'x-mezfit-invite-start-param': launch,
    },
  });
}

beforeEach(() => {
  identity.mockReset();
  provision.mockReset();
  checkConfiguration.mockReset();
  identity.mockResolvedValue({
    user: { id: 202, first_name: 'Client' },
    authDate: new Date('2026-10-12T00:00:00Z'),
    startParam: launch,
  });
  provision.mockResolvedValue({ realmId: 'rlmtest' });
});

describe('accept a Telegram invitation into a real Dexie relationship', () => {
  it('provisions the cloud pair before activating the D1 legacy view', async () => {
    const f = fixture();
    provision.mockImplementation(async () => {
      expect(f.batch).not.toHaveBeenCalled();
      expect(f.acceptedBy()).toBe(client.id);
      return { realmId: 'rlmtest' };
    });
    const response = await worker.fetch(request(), f.env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, roles: ['client'] });
    expect(checkConfiguration).toHaveBeenCalledWith(f.env);
    expect(provision).toHaveBeenCalledWith(f.env, '101', '202');
    expect(f.batch).toHaveBeenCalledTimes(1);
    expect(f.isLinked()).toBe(true);
  });

  it('does not reserve an invitation or create an active link without configured secrets', async () => {
    const f = fixture();
    checkConfiguration.mockImplementationOnce(() => {
      throw new CloudMembershipError('CLOUD_MEMBERSHIP_NOT_CONFIGURED', 503);
    });
    const response = await worker.fetch(request(), f.env);

    expect(response.status).toBe(503);
    expect(f.acceptedBy()).toBeNull();
    expect(f.batch).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it('leaves no active D1 link when cloud provisioning fails and permits the same user to retry', async () => {
    const f = fixture();
    provision.mockRejectedValueOnce(new CloudMembershipError('CLOUD_MEMBERSHIP_UNAVAILABLE', 502));
    const failed = await worker.fetch(request(), f.env);
    expect(failed.status).toBe(502);
    expect(f.isLinked()).toBe(false);
    expect(f.batch).not.toHaveBeenCalled();
    expect(f.acceptedBy()).toBe(client.id);

    const preview = await worker.fetch(request('/api/invite/current', 'GET'), f.env);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ invite: { coach: { firstName: 'Coach' } } });

    const retry = await worker.fetch(request(), f.env);
    expect(retry.status).toBe(200);
    expect(f.isLinked()).toBe(true);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('retries a verified cloud link if the legacy D1 projection failed', async () => {
    const f = fixture();
    f.failD1Once();
    const failed = await worker.fetch(request(), f.env);
    expect(failed.status).toBe(500);
    expect(f.isLinked()).toBe(false);

    f.restoreD1();
    const retried = await worker.fetch(request(), f.env);
    expect(retried.status).toBe(200);
    expect(provision).toHaveBeenCalledTimes(2);
  });
});
