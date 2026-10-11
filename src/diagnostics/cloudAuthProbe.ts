import { getDexieCloudTokens } from '../api';

/**
 * One-shot production auth probe. Unlike the Dexie Cloud Addon, it does not
 * open IndexedDB, persist tokens, mount sync or use any domain repository.
 */
export async function runCloudAuthProbe(initData: string): Promise<void> {
  if (!initData) throw new Error('TELEGRAM_AUTH_REQUIRED');
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_UNAVAILABLE');

  // Match the Dexie Cloud Addon's RSA public_key (PEM/SPKI) protocol.
  // The private key is non-exportable and discarded after this request.
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  let binary = '';
  for (const byte of spki) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  const publicKeyPem = ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');

  // The Worker verifies the Telegram signature and cloud claims.sub.
  // Intentionally discard the full access/refresh token response.
  await getDexieCloudTokens(initData, { public_key: publicKeyPem });
}
