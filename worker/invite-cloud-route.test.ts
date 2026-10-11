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
  let actor = client;
  let available = true;
  let failProjection = false;
  const connected = new Set<number>();
  const invite = {
    id: 41, coach_user_id: 1, coach_telegram_user_id: '101', label: null,
    expires_at: '2030-01-01T00:00:00Z',
    coach_first_name: 'Coach', coach_last_name: null, coach_username: null,
  };

  const prepare = vi.fn((sql: string) => ({
    bind: (..._args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id = ?')) {
          return actor;
        }
        if (sql.includes('FROM coach_client_invite i')) {
          return available ? invite : null;
        }
        throw Error('Unexpected SQL first: ' + sql);
      },
      all: async () => {
        if (sql === 'SELECT role FROM user_role WHERE user_id = ? ORDER BY role') {
          return { results: connected.has(actor.id) ? [{ role: 'client' }] : [] };
        }
        throw Error('Unexpected SQL all: ' + sql);
      },
    }),
  }));
  const batch = vi.fn(async () => {
    if (failProjection) throw Error('D1 unavailable');
    connected.add(actor.id);
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
    isLinked: (id = client.id) => connected.has(id),
    switchToOtherClient: () => { actor = { ...client, id: 3, telegram_user_id: '303' }; },
    disableInvite: () => { available = false; },
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

describe('accept a reusable Telegram invitation into a Dexie relationship', () => {
  it('provisions the cloud pair before activating the D1 legacy view', async () => {
    const f = fixture();
    provision.mockImplementation(async () => {
      expect(f.batch).not.toHaveBeenCalled();
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

  it('does not create an active link without configured cloud secrets', async () => {
    const f = fixture();
    checkConfiguration.mockImplementationOnce(() => {
      throw new CloudMembershipError('CLOUD_MEMBERSHIP_NOT_CONFIGURED', 503);
    });
    const response = await worker.fetch(request(), f.env);

    expect(response.status).toBe(503);
    expect(f.batch).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it('keeps the invitation available for retry when cloud provisioning fails', async () => {
    const f = fixture();
    provision.mockRejectedValueOnce(new CloudMembershipError('CLOUD_MEMBERSHIP_UNAVAILABLE', 502));
    const failed = await worker.fetch(request(), f.env);
    expect(failed.status).toBe(502);
    expect(f.isLinked()).toBe(false);
    expect(f.batch).not.toHaveBeenCalled();

    const preview = await worker.fetch(request('/api/invite/current', 'GET'), f.env);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ invite: { coach: { firstName: 'Coach' } } });

    const retry = await worker.fetch(request(), f.env);
    expect(retry.status).toBe(200);
    expect(f.isLinked()).toBe(true);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('allows the same invitation to connect different athletes', async () => {
    const f = fixture();
    expect((await worker.fetch(request(), f.env)).status).toBe(200);
    f.switchToOtherClient();
    identity.mockResolvedValue({
      user: { id: 303, first_name: 'Other Client' },
      authDate: new Date('2026-10-12T00:00:00Z'),
      startParam: launch,
    });

    const response = await worker.fetch(request(), f.env);
    expect(response.status).toBe(200);
    expect(f.isLinked(2)).toBe(true);
    expect(f.isLinked(3)).toBe(true);
    expect(provision).toHaveBeenCalledTimes(2);
    expect(provision).toHaveBeenNthCalledWith(1, f.env, '101', '202');
    expect(provision).toHaveBeenNthCalledWith(2, f.env, '101', '303');
  });

  it('returns success on retry after the first success response was lost', async () => {
    const f = fixture();
    expect((await worker.fetch(request(), f.env)).status).toBe(200);
    const retried = await worker.fetch(request(), f.env);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({ ok: true, roles: ['client'] });
    expect(f.batch).toHaveBeenCalledTimes(2);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired or revoked invitation before provisioning', async () => {
    const f = fixture();
    f.disableInvite();
    const response = await worker.fetch(request(), f.env);
    expect(response.status).toBe(410);
    expect(provision).not.toHaveBeenCalled();
    expect(f.batch).not.toHaveBeenCalled();
  });

  it('retries an already provisioned cloud link after a legacy D1 projection failure', async () => {
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
