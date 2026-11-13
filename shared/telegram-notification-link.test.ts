import { describe, expect, it } from 'vitest';
import { notificationStartParam, parseNotificationStartParam } from './telegram-notification-link';

describe('Telegram notification links', () => {
  it('round-trips discussion and workout identities through Telegram-safe start parameters', () => {
    const discussion = { kind: 'discussion', id: 'media:отчёт_1' } as const;
    const workout = { kind: 'workout', id: 'workout:2026-11-13' } as const;
    for (const target of [discussion, workout]) {
      const param = notificationStartParam(target);
      expect(param).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
      expect(parseNotificationStartParam(param)).toEqual(target);
    }
  });

  it('leaves invitation and invalid parameters to their own handlers', () => {
    expect(parseNotificationStartParam('invite_abc')).toBeNull();
    expect(parseNotificationStartParam('notify_workout_@@')).toBeNull();
    expect(parseNotificationStartParam('notify_workout__w')).toBeNull();
    expect(() => notificationStartParam({ kind: 'workout', id: 'x'.repeat(500) })).toThrow('INVALID_NOTIFICATION_TARGET');
  });
});
