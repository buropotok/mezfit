export interface TelegramInitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ValidatedTelegramInitData {
  user: TelegramInitUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
}

export class TelegramAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramAuthError';
  }
}

const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || left.length % 2 !== 0) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  now = new Date(),
  maxAgeSeconds = 24 * 60 * 60,
): Promise<ValidatedTelegramInitData> {
  if (!initData) throw new TelegramAuthError('Telegram init data is missing');
  if (!botToken) throw new TelegramAuthError('Telegram bot token is not configured');

  const params = new URLSearchParams(initData);
  const suppliedHash = params.get('hash');
  if (!suppliedHash) throw new TelegramAuthError('Telegram init data hash is missing');

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const expectedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqualHex(expectedHash, suppliedHash.toLowerCase())) {
    throw new TelegramAuthError('Telegram init data signature is invalid');
  }

  const authDateSeconds = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) {
    throw new TelegramAuthError('Telegram auth_date is invalid');
  }

  const authDate = new Date(authDateSeconds * 1000);
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds < -60 || ageSeconds > maxAgeSeconds) {
    throw new TelegramAuthError('Telegram init data is expired');
  }

  const userJson = params.get('user');
  if (!userJson) throw new TelegramAuthError('Telegram user is missing');

  let user: TelegramInitUser;
  try {
    user = JSON.parse(userJson) as TelegramInitUser;
  } catch {
    throw new TelegramAuthError('Telegram user payload is invalid');
  }

  if (!Number.isSafeInteger(user.id) || user.id <= 0 || !user.first_name) {
    throw new TelegramAuthError('Telegram user payload is incomplete');
  }

  return {
    user,
    authDate,
    queryId: params.get('query_id') ?? undefined,
    startParam: params.get('start_param') ?? undefined,
  };
}
