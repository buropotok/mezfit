import { describe, expect, it, vi } from 'vitest';
import { reminderRecipients, sendWorkoutReminders } from './workout-reminders';
import type { WorkoutReminderEnv } from './workout-reminders';
import { flexAttributeId, flexValueId } from '../../shared/flex-identifiers';
import { relationshipMembership } from './dexie-cloud-membership';

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
          { ...candidate, entryKind: 'invalid_type' },
          { ...candidate, inactive: 'true' },
          { ...candidate, startsAtUtc: '2026-11-05T11:00:00' },
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

describe('personal Cron reminder delivery', () => {
  function fakeDb() {
    const ledger = new Map<string, { status: string; attempts: number }>();
    const prepare = (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: [{ role: 'coach' }] }),
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO workout_reminder_delivery')) {
            const key = String(args[0]);
            if (!ledger.has(key)) ledger.set(key, { status: 'pending', attempts: 0 });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'sending'")) {
            const key = String(args[1]);
            const row = ledger.get(key);
            if (!row || (row.status !== 'pending' && row.status !== 'retry') || row.attempts >= 3)
              return { meta: { changes: 0 } };
            row.status = 'sending';
            row.attempts += 1;
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SET status = ?, telegram_message_id = ?')) {
            const row = ledger.get(String(args[5]));
            if (row) row.status = String(args[0]);
            return { meta: { changes: row ? 1 : 0 } };
          }
          throw new Error('Unexpected D1 mutation');
        },
      }),
    });
    return { db: { prepare } as unknown as D1Database, ledger };
  }

  it('delivers to a Coach athlete once and does not replay it at a second Cron tick', async () => {
    const now = Date.parse('2026-11-05T10:00:00.000Z');
    const row = {
      id: 'personal-workout', owner: athlete, ...personal,
      startsAtUtc: '2026-11-05T11:00:00.000Z',
      status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
    };
    const telegramCalls: string[] = [];
    const fetchUpstream = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ type: 'tokens', accessToken: 'read-only-token' });
      if (url.includes('/all/workoutOccurrences?')) return Response.json([row]);
      if (url.includes('/all/workoutOccurrences/personal-workout')) return Response.json(row);
      if (url.includes('/all/flexValues/')) return new Response(null, { status: 404 });
      if (url.includes('/sendMessage')) {
        telegramCalls.push(url);
        return Response.json({ ok: true, result: { message_id: 22 } });
      }
      throw new Error('Unexpected upstream request');
    });
    const fake = fakeDb();
    const env: WorkoutReminderEnv = {
      DB_BINDING: fake.db, TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
      DEXIE_CLOUD_REMINDER_CLIENT_ID: 'readonly', DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'secret',
    };

    await sendWorkoutReminders(env, now, fetchUpstream);
    await sendWorkoutReminders(env, now + 5 * 60 * 1000, fetchUpstream);

    expect(telegramCalls).toHaveLength(1);
    expect([...fake.ledger.values()]).toEqual([{ status: 'sent', attempts: 1 }]);
  });

  it('suppresses reminders when the personal preference is off', async () => {
    const now = Date.parse('2026-11-05T10:00:00.000Z');
    const row = {
      id: 'personal-workout', owner: athlete, ...personal,
      startsAtUtc: '2026-11-05T11:00:00.000Z',
      status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
    };
    const fetchUpstream = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ type: 'tokens', accessToken: 'read-only-token' });
      if (url.includes('/all/workoutOccurrences?')) return Response.json([row]);
      if (url.includes('/all/flexValues/')) {
        const id = decodeURIComponent(url.split('/').at(-1) ?? '');
        return Response.json({
          id, realmId: athlete, owner: athlete, entityType: 'user', entityId: athlete,
          attributeId: flexAttributeId(athlete, 'notify_coach_own_workouts'),
          value: false,
        });
      }
      throw new Error('Disabled reminder must not read the occurrence again or call Telegram');
    });
    const env: WorkoutReminderEnv = {
      DB_BINDING: fakeDb().db, TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
      DEXIE_CLOUD_REMINDER_CLIENT_ID: 'readonly', DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'secret',
    };
    await sendWorkoutReminders(env, now, fetchUpstream);
    expect(fetchUpstream.mock.calls.every(([url]) => !String(url).includes('/sendMessage'))).toBe(true);
  });
});

describe('shared-workout delivery integration', () => {
  const now = Date.parse('2026-11-05T10:00:00.000Z');
  const startsAtUtc = '2026-11-05T11:00:00.000Z';

  function fakeDeliveryDb() {
    const sent = new Set<string>();
    const prepare = (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR IGNORE INTO workout_reminder_delivery')) {
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'sending'")) {
            const id = String(args[1]);
            if (sent.has(id)) return { meta: { changes: 0 } };
            sent.add(id);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SET status = ?, telegram_message_id = ?')) {
            return { meta: { changes: 1 } };
          }
          throw new Error('Unexpected D1 statement');
        },
      }),
    });
    return { prepare } as unknown as D1Database;
  }

  async function setup(format: 'independent' | 'coached', disabledCoach = false, failAthlete = false) {
    const { realm, members } = await relationshipMembership(coach.slice(3), athlete.slice(3));
    const occurrence = {
      id: 'shared-workout-1', realmId: realm.realmId, owner: realm.realmId,
      athleteUserId: athlete, coachUserId: coach, clientUserId: athlete,
      startsAtUtc, format, status: 'scheduled', publicationStatus: 'published',
      workoutSessionId: null,
    };
    const sentChats: string[] = [];
    const fetched = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ type: 'tokens', accessToken: 'read-only-token' });
      if (url.includes('/all/workoutOccurrences?')) return Response.json([occurrence]);
      if (url.includes('/all/realms/')) return Response.json(realm);
      if (url.includes('/all/members?')) return Response.json(members);
      if (url.includes('/all/flexValues/')) {
        const id = decodeURIComponent(url.split('/').at(-1) ?? '');
        const coachAttribute = flexAttributeId(coach, 'notify_coach_client_workouts');
        const coachValue = flexValueId({ entityType: 'user', entityId: coach, realmId: coach }, coachAttribute);
        if (disabledCoach && id === coachValue) {
          return Response.json({
            id, realmId: coach, owner: coach, attributeId: coachAttribute,
            entityType: 'user', entityId: coach, value: false,
          });
        }
        if (failAthlete && id !== coachValue) return new Response(null, { status: 503 });
        return new Response(null, { status: 404 });
      }
      if (url.includes('/all/workoutOccurrences/shared-workout-1')) return Response.json(occurrence);
      if (url.includes('/sendMessage')) {
        const payload: unknown = JSON.parse(String(init?.body));
        if (!payload || typeof payload !== 'object' || !('chat_id' in payload)) throw Error('INVALID_BOT_REQUEST');
        sentChats.push(String(payload.chat_id));
        return Response.json({ ok: true, result: { message_id: sentChats.length } });
      }
      throw new Error('Unexpected upstream request ' + url.replace(/bot[^/]+/, 'botREDACTED'));
    });
    const env: WorkoutReminderEnv = {
      DB_BINDING: fakeDeliveryDb(), TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
      DEXIE_CLOUD_REMINDER_CLIENT_ID: 'readonly', DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'secret',
    };
    return { fetched, env, sentChats };
  }

  it('notifies only the athlete for an independent assigned workout', async () => {
    const setupCase = await setup('independent');
    await sendWorkoutReminders(setupCase.env, now, setupCase.fetched);
    expect(setupCase.sentChats).toEqual([athlete.slice(3)]);
  });

  it('notifies both athletes and participating coaches for coached workouts', async () => {
    const setupCase = await setup('coached');
    await sendWorkoutReminders(setupCase.env, now, setupCase.fetched);
    expect(setupCase.sentChats).toEqual([athlete.slice(3), coach.slice(3)]);
  });

  it('respects the coach opt-out without suppressing the athlete reminder', async () => {
    const setupCase = await setup('coached', true);
    await sendWorkoutReminders(setupCase.env, now, setupCase.fetched);
    expect(setupCase.sentChats).toEqual([athlete.slice(3)]);
  });

  it('continues with the coach if the athlete preference lookup fails, and reports partial failure', async () => {
    const setupCase = await setup('coached', false, true);
    await expect(sendWorkoutReminders(setupCase.env, now, setupCase.fetched))
      .rejects.toThrow('REMINDERS_PARTIAL_FAILURE');
    expect(setupCase.sentChats).toEqual([coach.slice(3)]);
  });
});
