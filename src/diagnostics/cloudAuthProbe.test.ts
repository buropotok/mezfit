import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDexieCloudTokens } from '../api';
import { runCloudAuthProbe } from './cloudAuthProbe';

vi.mock('../api', () => ({ getDexieCloudTokens: vi.fn() }));

const getTokensMock = vi.mocked(getDexieCloudTokens);

afterEach(() => {
  vi.restoreAllMocks();
  getTokensMock.mockReset();
});

describe('one-shot Dexie Cloud auth probe', () => {
  it('sends a real RSA SPKI PEM public key through the typed Telegram Worker API', async () => {
    getTokensMock.mockResolvedValue({
      type: 'tokens',
      claims: { sub: 'tg:42' },
      accessToken: 'must-never-display',
      accessTokenExpiration: Date.now() + 60_000,
      userType: 'prod',
    });

    await expect(runCloudAuthProbe('signed-telegram-init-data')).resolves.toBeUndefined();
    expect(getTokensMock).toHaveBeenCalledTimes(1);
    const [initData, params] = getTokensMock.mock.calls[0];
    expect(initData).toBe('signed-telegram-init-data');
    expect(params.public_key).toMatch(/^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{1,64}\n)+-----END PUBLIC KEY-----$/);

    // Verify that the generated public key is valid rather than an arbitrary string.
    const encoded = params.public_key
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const spki = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify'],
    );
    expect(publicKey.type).toBe('public');
    expect(publicKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
  });

  it('rejects missing Telegram auth without contacting the Worker', async () => {
    await expect(runCloudAuthProbe('')).rejects.toThrow('TELEGRAM_AUTH_REQUIRED');
    expect(getTokensMock).not.toHaveBeenCalled();
  });

  it('propagates Worker failure without retrying or persisting anything', async () => {
    getTokensMock.mockRejectedValue(new Error('Worker unavailable'));
    await expect(runCloudAuthProbe('signed-telegram-init-data')).rejects.toThrow('Worker unavailable');
    expect(getTokensMock).toHaveBeenCalledTimes(1);
  });
});
