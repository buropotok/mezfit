export function telegramUserIdFromInitData(initData: string): string {
  const rawUser = new URLSearchParams(initData).get('user');
  if (!rawUser) throw new Error('TELEGRAM_USER_ID_MISSING');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser) as unknown;
  } catch {
    throw new Error('TELEGRAM_USER_ID_INVALID');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('TELEGRAM_USER_ID_INVALID');
  }

  const id = (parsed as { id?: unknown }).id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return String(id);
  if (typeof id === 'string' && /^[1-9]\d*$/.test(id)) return id;

  throw new Error('TELEGRAM_USER_ID_INVALID');
}
