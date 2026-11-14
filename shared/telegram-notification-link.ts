import { discussionId } from './discussion-anchor';

export const COACH_TELEGRAM_PREFERENCES = {
  telegram: 'notify_coach_telegram',
  discussion: 'notify_coach_discussions',
} as const;

export type TelegramNotificationTarget = { kind: 'discussion' | 'workout'; id: string; receipt?: string };

export function notificationStartParam(target: TelegramNotificationTarget): string {
  const bytes = new TextEncoder().encode(target.id);
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const param = (target.receipt ? 'ntf_' + target.receipt + '_' : 'notify_') + target.kind + '_' + encoded;
  if (!discussionId(target.id) || param.length > 512 || (target.receipt !== undefined && !/^[0-9a-f]{32}$/.test(target.receipt))) throw new Error('INVALID_NOTIFICATION_TARGET');
  return param;
}

export function parseNotificationStartParam(value: string | null): TelegramNotificationTarget | null {
  if (!value || value.length > 512) return null;
  const match = /^(?:notify_|ntf_([0-9a-f]{32})_)(discussion|workout)_([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[3].replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    const id = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const kind = match[2] === 'discussion' ? 'discussion' : 'workout';
    return discussionId(id) ? { kind, id, ...(match[1] ? { receipt: match[1] } : {}) } : null;
  } catch {
    return null;
  }
}
