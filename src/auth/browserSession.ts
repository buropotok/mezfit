/** A browser OIDC session is a verified identity only, never a Mini App grant. */
export interface BrowserIdentity {
  telegramUserId: string;
  name: string;
  username: string;
}

/** Parse the same-origin server response without trusting arbitrary JSON. */
export function parseBrowserSession(value: unknown): BrowserIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.authenticated !== true
      || typeof record.telegramUserId !== 'string'
      || !/^[1-9]\d{0,15}$/.test(record.telegramUserId)
      || typeof record.name !== 'string'
      || record.name.length > 120
      || typeof record.username !== 'string'
      || record.username.length > 64) return null;
  return {
    telegramUserId: record.telegramUserId,
    name: record.name,
    username: record.username,
  };
}
