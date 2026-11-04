import { describe, expect, it, vi } from 'vitest';
import { reminderRecipients, sendWorkoutReminders } from './workout-reminders';
import type { WorkoutReminderEnv } from './workout-reminders';

const athlete = 'tg:123';
const coach = 'tg:456';
const shared = {
  realmId: 'relationship-realm',
  athleteUserId: athlete,
  coachUserId: coach,
  clientUserId: athlete,
};
const personal = {
  realmId: athlete,
  athleteUserId: athlete,
  coachUserId: null,
  clientUserId: null,
  format: 'independent' as const,
};

describe('workout reminder recipients', () => {
  it('sends an athlete reminder for independent personal workouts in either role', () => {
    expect(reminderRecipients(personal, 'coach')).toEqual([{ userId: athlete, preference: 'own' }]);
    expect(reminderRecipients(personal, 'client')).toEqual([{ userId: athlete, preference: 'client' }]);
    expect(reminderRecipients(personal)).toEqual([]);
  });

  it('never notifies the coach of the athlete\'s independent workout', () => {
    expect(reminderRecipients({ ...shared, format: 'independent' }))
      .toEqual([{ userId: athlete, preference: 'client' }]);
  });

  it('notifies both physical participants for a coached session with independent preferences', () => {
    expect(reminderRecipients({ ...shared, format: 'coached' })).toEqual([
      { userId: athlete, preference: 'client' },
      { userId: coach, preference: 'coached' },
    ]);
  });

  it('ignores invalid and self-referential participant data', () => {
    expect(reminderRecipients({ ...shared, clientUserId: 'tg:789', format: 'coached' })).toEqual([]);
    expect(reminderRecipients({ ...shared, coachUserId: athlete, format: 'coached' })).toEqual([]);
  });
});

describe('scheduled delivery security', () => {
  it('fails closed without a separate read-only cloud credential', async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const env = { DB_BINDING: {} as D1Database, TELEGRAM_BOT_TOKEN: 'secret',
      TELEGRAM_BOT_USERNAME: 'mezfit_bot' } satisfies WorkoutReminderEnv;
    await expect(sendWorkoutReminders(env, Date.now(), fetchUpstream))
      .rejects.toThrow('REMINDERS_CLOUD_READ_NOT_CONFIGURED');
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('never considers unpublished, cancelled, personal events, or started workouts', async () => {
    const fetchUpstream = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({
        type: 'tokens', accessToken: 'read-only-token',
      });
      if (url.includes('/all/workoutOccurrences')) {
        const startsAtUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const candidate = {
          id: 'workout-1', owner: athlete, ...personal, startsAtUtc, status: 'scheduled',
          workoutSessionId: null, publicationStatus: 'published',
        };
        return Response.json([
          { ...candidate, publicationStatus: 'draft' },
          { ...candidate, status: 'cancelled' },
          { ...candidate, cancelledAt: startsAtUtc },
          { ...candidate, inactive: true },
          { ...candidate, entryKind: 'personal_event' },
          { ...candidate, workoutSessionId: 'session-1' },
        ]);
      }
      throw new Error('Unexpected upstream call');
    });
    const env: WorkoutReminderEnv = {
      DB_BINDING: {} as D1Database, TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
      DEXIE_CLOUD_REMINDER_CLIENT_ID: 'readonly', DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'secret',
    };
    await sendWorkoutReminders(env, Date.now(), fetchUpstream);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });
});
