import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendTopicTelegram } from './coach-telegram';
import { cloudIdForVerifiedTelegram, linkedTelegramAccount } from './password-credentials';
import { relationshipMembership } from './dexie-cloud-membership';

const linkedId = 4503599627370600;
const unlinkedId = 4503599627370601;
let sqlite;
let db;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_users_and_roles.sql', '0036_password_credentials.sql']) {
    sqlite.exec(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO app_user (id, telegram_user_id, first_name) VALUES (51, '123456789', 'A'), (52, '987654321', 'B');
    INSERT INTO password_credentials (user_id, app_user_id) VALUES (123456789, 51), (${linkedId}, 52);
    INSERT INTO password_credentials (user_id, login, pass_hash) VALUES (${unlinkedId}, 'fixture', 'encoded-fixture');
  `);
  db = { prepare: vi.fn(sql => ({
    bind: (...args) => ({
      first: async () => {
        if (sql.includes('FROM telegram_coach_topics')) return { telegram_thread_id: 7, topic_title: 'Общее' };
        return sqlite.prepare(sql).get(...args) ?? null;
      },
      run: async () => ({ meta: { changes: 1 } }),
    }),
  })) };
});

afterEach(() => sqlite.close());

it('resolves both directions without changing a Telegram-first subject', async () => {
  expect(await cloudIdForVerifiedTelegram(db, 123456789)).toBe('tg:123456789');
  expect(await linkedTelegramAccount(db, 'tg:123456789'))
    .toEqual({ appUserId: 51, telegramId: '123456789' });
  expect(await cloudIdForVerifiedTelegram(db, 987654321)).toBe(`tg:${linkedId}`);
  expect(await linkedTelegramAccount(db, `tg:${linkedId}`))
    .toEqual({ appUserId: 52, telegramId: '987654321' });
  const { members } = await relationshipMembership('123456789', String(linkedId));
  expect(members.map(member => member.userId)).toEqual(['tg:123456789', `tg:${linkedId}`]);
});

it('rejects malformed, missing and conflicting mappings', async () => {
  for (const malformed of ['tg:0123', 'tg:１２３', 'tg:9007199254740992', 'tg:0']) {
    expect(await linkedTelegramAccount(db, malformed)).toBeNull();
  }
  expect(db.prepare).not.toHaveBeenCalled();
  expect(await linkedTelegramAccount(db, 'tg:987654321')).toBeNull();
  expect(await cloudIdForVerifiedTelegram(db, 101)).toBeNull();
  await expect(cloudIdForVerifiedTelegram(db, linkedId)).rejects.toThrow('TELEGRAM_ID_OUTSIDE_SUPPORTED_RANGE');
  sqlite.exec("UPDATE app_user SET telegram_user_id = '12345' WHERE id = 51");
  await expect(cloudIdForVerifiedTelegram(db, 12345)).rejects.toThrow('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
  await expect(linkedTelegramAccount(db, 'tg:123456789')).rejects.toThrow('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
});

it('sends to the confirmed Telegram chat and skips an unlinked account', async () => {
  const telegram = vi.fn(async () => Response.json({ ok: true, result: { message_id: 42 } }));
  const env = { DB_BINDING: db, TELEGRAM_BOT_TOKEN: 'fixture', TELEGRAM_BOT_USERNAME: 'mezfit_bot' };
  const notify = userId => sendTopicTelegram(env, {
    recipientUserId: userId, title: 'Обсуждение', button: 'Открыть',
    target: { kind: 'discussion', id: 'message-1' },
  }, telegram);
  expect((await notify('tg:123456789')).status).toBe('sent');
  expect((await notify(`tg:${linkedId}`)).status).toBe('sent');
  expect((await notify(`tg:${unlinkedId}`)).status).toBe('blocked');
  db.prepare.mockImplementationOnce(() => { throw new Error('D1 unavailable'); });
  expect((await notify(`tg:${linkedId}`)).status).toBe('retry');
  expect(telegram.mock.calls.map(([, options]) => JSON.parse(options.body).chat_id))
    .toEqual(['123456789', '987654321']);
});
