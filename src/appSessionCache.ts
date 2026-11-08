import type { MeResponse } from './api';

/** Only a previously Worker-confirmed profile is eligible for local display.
 * This is NOT an authorization grant. Network operations always verify Telegram
 * initData with the Worker; no initData or tokens are persisted.
 */
const PREFIX = 'mezfit.confirmedAccount.v1.';
const VERSION = 1;
interface CachedAccount { version: typeof VERSION; me: MeResponse }

function launchUserId(initData: string): string | null {
  // Select a cached account only for a Telegram-shaped signed launch.
  // Checking hash syntax is not client-side signature verification.
  const params = new URLSearchParams(initData);
  if (!/^[a-f0-9]{64}$/.test(params.get('hash') ?? '')) return null;
  const raw = params.get('user');
  if (!raw) return null;
  try {
    const user: unknown = JSON.parse(raw);
    if (!user || typeof user !== 'object' || !('id' in user)) return null;
    const id = user.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  } catch { return null; }
}

function isCachedMe(value: unknown, userId: string): value is MeResponse {
  if (!value || typeof value !== 'object' || !('user' in value) || !('roles' in value)) return false;
  const me = value as { user: unknown; roles: unknown };
  if (!me.user || typeof me.user !== 'object') return false;
  const user = me.user as Record<string, unknown>;
  return user.telegramUserId === userId
    && typeof user.id === 'number' && Number.isSafeInteger(user.id) && user.id > 0
    && typeof user.firstName === 'string'
    && (user.lastName === null || typeof user.lastName === 'string')
    && (user.username === null || typeof user.username === 'string')
    && (user.languageCode === null || typeof user.languageCode === 'string')
    && (user.photoUrl === null || typeof user.photoUrl === 'string')
    && typeof user.isPremium === 'boolean'
    && Array.isArray(me.roles) && me.roles.length <= 2
    && me.roles.every(role => role === 'coach' || role === 'client');
}

export function readConfirmedAccount(initData: string): MeResponse | null {
  const id = launchUserId(initData);
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object' || !('version' in record)
      || !('me' in record) || record.version !== VERSION || !isCachedMe(record.me, id)) return null;
    return record.me;
  } catch { return null; }
}

export function saveConfirmedAccount(initData: string, me: MeResponse): void {
  const id = launchUserId(initData);
  if (!id || !isCachedMe(me, id)) return;
  try {
    const record: CachedAccount = { version: VERSION, me };
    window.localStorage.setItem(PREFIX + id, JSON.stringify(record));
  } catch { /* Storage may be disabled. */ }
}

export function clearConfirmedAccount(initData: string): void {
  const id = launchUserId(initData);
  if (!id) return;
  try { window.localStorage.removeItem(PREFIX + id); }
  catch { /* Storage may be disabled. */ }
}
