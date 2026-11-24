import { checkBrowserDexieCloudToken, getDexieCloudTokens } from '../api';

/**
 * One-shot production auth probe. Unlike the Dexie Cloud Addon, it does not
 * open IndexedDB, persist tokens, mount sync or use any domain repository.
 */
export async function runCloudAuthProbe(initData: string): Promise<void> {
  if (!initData) throw new Error('TELEGRAM_AUTH_REQUIRED');
  // The Worker verifies the Telegram signature and cloud claims.sub.
  await getDexieCloudTokens(initData, { public_key: await createPublicKey() });
}

export async function runBrowserCloudAuthProbe(telegramUserId: string, signal: AbortSignal) {
  const publicKey = await createPublicKey();
  return checkBrowserDexieCloudToken(publicKey, telegramUserId, signal);
}

async function createPublicKey(): Promise<string> {
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
  return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');
}
