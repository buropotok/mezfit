import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { provisionInviteMembership } from './lib/dexie-cloud-membership';
import { sha256Hex } from './lib/tokens';
import { validateTelegramInitData } from './lib/telegram';

vi.mock('./lib/telegram', async (original) => ({
  ...await original(),
  validateTelegramInitData: vi.fn(),
}));

vi.mock('./lib/dexie-cloud-membership', async (original) => ({
  ...await original(),
  provisionInviteMembership: vi.fn(),
  requireCloudMembershipConfiguration: vi.fn(),
}));

const path = '/api/telegram/bot-webhook';
const secret = 'test-bot-webhook-secret';
const token = 'ab'.repeat(18);
const previewText = `/start invite_${token}`;
let db;
let env;
let transport;
let replicate;
let notification;
let nextId;
let now;
let beforeBatch;
let afterBatch;

const user = (id) => ({ id, is_bot: false, first_name: 'Клиент', language_code: 'ru' });
const message = (id, fields) => ({ message_id: ++nextId, date: Math.floor(now / 1000),
  chat: { type: 'private', id }, ...fields });
const start = (id = 202, text = previewText) => ({
  update_id: ++nextId, message: message(id, { from: user(id), text }),
});
const callback = (data, id = 202) => ({
  update_id: ++nextId,
  callback_query: {
    id: String(++nextId), from: user(id), data, message: message(id, { from: { id: 111, is_bot: true } }),
  },
});

const row = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const count = (table) => row(`SELECT count(*) AS n FROM ${table}`).n;
const outbox = (id = '202') => row('SELECT * FROM account_replication_outbox WHERE telegram_user_id = ?', id);

function send(update, { key = secret, method = 'POST', route = path } = {}) {
  const request = new Request('https://worker.test' + route, {
    method,
    headers: key === null ? {} : { 'x-telegram-bot-api-secret-token': key },
    body: method === 'POST' ? typeof update === 'string' ? update : JSON.stringify(update) : undefined,
  });
  return worker.fetch(request, env);
}

function latestMessage() {
  return notification.mock.calls.filter(([method]) => method !== 'answerCallbackQuery').at(-1)?.[1];
}

async function show(id = 202, text = previewText) {
  expect((await send(start(id, text))).status).toBe(200);
  const [[accept, cancel]] = latestMessage().reply_markup.inline_keyboard;
  expect(accept.text).toBe('Принять');
  expect(cancel.text).toBe('Отмена');
  expect(Buffer.byteLength(accept.callback_data)).toBeLessThanOrEqual(64);
  return { accept: accept.callback_data, cancel: cancel.callback_data };
}

function assertNoRegistration() {
  expect(count('app_user')).toBe(1);
  expect(count('coach_client')).toBe(0);
  expect(count('user_role')).toBe(1);
  expect(count('account_replication_outbox')).toBe(0);
  expect(provisionInviteMembership).not.toHaveBeenCalled();
  expect(replicate).not.toHaveBeenCalled();
}

beforeEach(async () => {
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  db = new DatabaseSync(':memory:');
  const migrations = ['0001_users_and_roles.sql', '0002_coach_client_links.sql',
    '0029_reusable_client_invites.sql', '0033_account_replication_outbox.sql',
    '0034_account_replication_diagnostics.sql', '0035_telegram_invite_consent.sql'];
  for (const migration of migrations) {
    if (migration.startsWith('0033')) {
      run("INSERT INTO app_user (telegram_user_id, first_name, last_name) VALUES ('101', 'Иванов', 'Иван')");
      run("INSERT INTO user_role (user_id, role) VALUES (1, 'coach')");
      run("INSERT INTO coach_client_invite (coach_user_id, token_hash, expires_at) VALUES (1, ?, datetime('now', '+30 days'))",
        await sha256Hex(token));
    }
    db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  }

  nextId = 0;
  beforeBatch = () => {};
  afterBatch = () => {};
  env = {
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_BOT_USERNAME: 'mezfit_bot',
    TELEGRAM_BOT_WEBHOOK_SECRET: secret,
    MEZFIT_ACCOUNT_REPLICATION_SECRET: 'test-replication-secret',
    DB_BINDING: {
      prepare: (sql) => ({
        bind: (...args) => {
          const stmt = db.prepare(sql);
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => ({ meta: stmt.run(...args) }),
            execute: () => readOrWrite(stmt, sql, args),
          };
        },
      }),
      batch: async (statements) => {
        beforeBatch(statements);
        db.exec('BEGIN');
        let result;
        try {
          result = statements.map(statement => statement.execute());
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        afterBatch(statements);
        return result;
      },
    },
  };
  provisionInviteMembership.mockReset().mockResolvedValue({ realmId: 'rlmtest' });
  validateTelegramInitData.mockReset();
  replicate = vi.fn(async (snapshot) => Response.json({ status: 'applied', revision: snapshot.revision }));
  notification = vi.fn(async (method) => Response.json({
    ok: true, result: method === 'answerCallbackQuery' ? true : { message_id: 99 },
  }));
  transport = vi.fn(async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === 'https://mezfit.online/api/internal/account-replication') return replicate(body);
    expect(options.redirect).toBe('manual');
    return notification(new URL(url).pathname.split('/').at(-1), body);
  });
  vi.stubGlobal('fetch', transport);
});

function readOrWrite(stmt, sql, args) {
  return sql.trimStart().startsWith('SELECT')
    ? { results: stmt.all(...args) }
    : { meta: stmt.run(...args) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

describe('Telegram bot invitations', () => {
  it('issues chat links only with rollout and configured webhook, preserving the coach role requirement', async () => {
    const create = () => worker.fetch(new Request('https://worker.test/api/coach/client-invites', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' }, body: '{}',
    }), env);
    validateTelegramInitData.mockResolvedValue({ user: user(101) });
    const old = await create();
    expect(old.status).toBe(201);
    const legacy = await old.json();
    expect(legacy.expiresInDays).toBe(30);
    expect(legacy.startParam).toMatch(/^invite_[a-f0-9]{36}$/);
    expect(legacy.telegramUrl).toBe('https://t.me/mezfit_bot?startapp=' + legacy.startParam);
    env.TELEGRAM_BOT_INVITES_ENABLED = 'true';
    const current = await (await create()).json();
    expect(current.telegramUrl).toBe('https://t.me/mezfit_bot?start=' + current.startParam);
    expect((await send(start(202, '/start ' + current.startParam))).status).toBe(200);
    delete env.TELEGRAM_BOT_WEBHOOK_SECRET;
    const disabled = await (await create()).json();
    expect(disabled.telegramUrl).toContain('?startapp=');

    validateTelegramInitData.mockResolvedValue({ user: user(202) });
    expect((await create()).status).toBe(403);
  });

  it('rejects unauthenticated or malformed requests before domain and Telegram API calls', async () => {
    expect((await send(start(), { method: 'GET' })).status).toBe(405);
    expect((await send(start(), { route: path + '/' })).status).toBe(404);
    expect((await send(start(), { key: 'different' })).status).toBe(401);
    expect((await send(start(), { key: null })).status).toBe(401);
    expect((await send('{')).status).toBe(400);
    expect((await send('x'.repeat(33 * 1024))).status).toBe(413);
    expect((await send({ ...start(), update_id: -1 })).status).toBe(400);
    delete env.TELEGRAM_BOT_WEBHOOK_SECRET;
    expect((await send(start())).status).toBe(503);
    expect(count('telegram_invite_consent')).toBe(0);
    expect(transport).not.toHaveBeenCalled();
    assertNoRegistration();
  });

  it('ignores groups, actor mismatches, inaccessible messages and forged actions', async () => {
    const group = start();
    group.message.chat.type = 'group';
    await send(group);
    const bot = start();
    bot.message.from.is_bot = true;
    await send(bot);
    const mismatch = start();
    mismatch.message.chat.id = 102;
    await send(mismatch);
    const invalid = start();
    invalid.message.from.id = Number.MAX_SAFE_INTEGER + 1;
    await send(invalid);
    expect(transport).not.toHaveBeenCalled();
    const { accept } = await show();
    expect(latestMessage().text).toBe('Вы получили приглашение от тренера Иванов Иван.');
    transport.mockClear();
    await send(callback(accept, 303));
    await send(callback('c' + accept.slice(1)));
    const inaccessible = callback(accept);
    inaccessible.callback_query.message.date = 0;
    await send(inaccessible);
    expect(transport).not.toHaveBeenCalled();
    assertNoRegistration();
  });

  it('cancels just the offer and does not recreate it on delivery retry', async () => {
    const update = start();
    await send(update);
    const [[accept, cancel]] = latestMessage().reply_markup.inline_keyboard;
    await send(callback(cancel.callback_data));
    expect(latestMessage().text).toContain('отменено');
    await send(callback(accept.callback_data));
    expect(latestMessage().text).toContain('отменено');
    await send(update);
    expect(count('telegram_invite_consent')).toBe(1);
    expect(row('SELECT revoked_at FROM coach_client_invite').revoked_at).toBeNull();
    await show();
    expect(count('telegram_invite_consent')).toBe(2);
    assertNoRegistration();
  });

  it('keeps ordinary and unrelated starts outside registration', async () => {
    await send(start(202, '/start'));
    expect(latestMessage().text).toContain('Добро пожаловать');
    transport.mockClear();
    await send(start(202, '/start unrelated'));
    expect(transport).not.toHaveBeenCalled();
    expect(count('telegram_invite_consent')).toBe(0);
    assertNoRegistration();
  });

  it('provisions verified identities before committing role, pair and outbox and confirms snapshot', async () => {
    const { accept, cancel } = await show();
    assertNoRegistration();
    provisionInviteMembership.mockImplementationOnce(async (_env, coach, client, _fetch, names) => {
      expect(coach).toBe('101');
      expect(client).toBe('202');
      expect(names).toEqual({ coach: 'Иванов Иван', client: 'Клиент' });
      expect(count('coach_client')).toBe(0);
      expect(outbox().revision).toBe(1);
      expect(notification.mock.calls.at(-1)[0]).toBe('answerCallbackQuery');
      return { realmId: 'rlmtest' };
    });
    const update = callback(accept);
    expect((await send(update)).status).toBe(200);
    expect(row("SELECT status FROM coach_client").status).toBe('active');
    expect(outbox()).toMatchObject({ revision: 2, next_attempt_at: null });
    expect(replicate).toHaveBeenCalledWith({
      revision: 2, roles: ['client'], user: {
        id: 2, telegramUserId: '202', firstName: 'Клиент', languageCode: 'ru',
        lastName: null, username: null, photoUrl: null, isPremium: false,
      },
    });
    expect(latestMessage().reply_markup.inline_keyboard[0][0].url).toBe('https://mezfit.online/');
    await send(update);
    await send(callback(cancel));
    expect(provisionInviteMembership).toHaveBeenCalledTimes(1);
    expect(replicate).toHaveBeenCalledTimes(1);
    expect(count('coach_client')).toBe(1);
  });

  it('adds client to an existing coach when Yandex is temporarily unavailable', async () => {
    run("INSERT INTO app_user (telegram_user_id, first_name, photo_url) VALUES ('202', 'Сохранённое имя', 'saved')");
    run("INSERT INTO user_role VALUES (2, 'coach', CURRENT_TIMESTAMP)");
    replicate.mockRejectedValueOnce(Error('offline'));
    await send(callback((await show()).accept));
    expect(replicate).toHaveBeenCalledWith(expect.objectContaining({
      revision: 3, roles: ['client', 'coach'],
      user: expect.objectContaining({ id: 2, firstName: 'Сохранённое имя', photoUrl: 'saved' }),
    }));
    expect(row("SELECT status FROM coach_client").status).toBe('active');
    expect(outbox()).toMatchObject({ revision: 3, attempts: 1, last_error: 'REQUEST_FAILED' });
    expect(latestMessage().text).toContain('Подготавливаем доступ');
  });

  it('preserves dual roles, profile and delivered outbox, and fills only a missing legacy row', async () => {
    run("INSERT INTO app_user (telegram_user_id, first_name, photo_url) VALUES ('202', 'Сохранённое имя', 'saved')");
    run("INSERT INTO user_role VALUES (2, 'coach', CURRENT_TIMESTAMP), (2, 'client', CURRENT_TIMESTAMP)");
    run("DELETE FROM account_replication_outbox WHERE telegram_user_id = '202'");
    const { accept } = await show();
    await send(callback(accept));
    expect(replicate).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['client', 'coach'], revision: 1,
      user: expect.objectContaining({ id: 2, firstName: 'Сохранённое имя', photoUrl: 'saved' }),
    }));
    const delivered = outbox();
    await send(callback((await show()).accept));
    expect(outbox()).toEqual(delivered);
    expect(replicate).toHaveBeenCalledTimes(1);

    run("INSERT INTO app_user (telegram_user_id, first_name) VALUES ('303', 'Тренер')");
    run("INSERT INTO user_role VALUES (3, 'coach', CURRENT_TIMESTAMP)");
    const another = 'cd'.repeat(18);
    run("INSERT INTO coach_client_invite (coach_user_id, token_hash, expires_at) VALUES (3, ?, datetime('now', '+30 days'))",
      await sha256Hex(another));
    await send(callback((await show(202, `/start invite_${another}`)).accept));
    expect(count('coach_client')).toBe(2);
    await send(callback((await show(404)).accept, 404));
    expect(count('coach_client')).toBe(3);
    expect(outbox('404').revision).toBe(2);
  });

  it.each(['expired', 'revoked', 'self'])('checks %s invitation again at acceptance', async (kind) => {
    const { accept } = await show();
    if (kind === 'expired') run("UPDATE coach_client_invite SET expires_at = datetime('now', '-1 day')");
    if (kind === 'revoked') run('UPDATE coach_client_invite SET revoked_at = CURRENT_TIMESTAMP');
    if (kind === 'self') run("UPDATE app_user SET telegram_user_id = '202' WHERE id = 1");
    await send(callback(accept));
    expect(latestMessage().text).toContain(kind === 'self' ? 'собственное' : 'недействительно');
    assertNoRegistration();
  });

  it('recovers from Cloud failure, a D1 projection failure, and a lost Telegram response', async () => {
    const { accept } = await show();
    provisionInviteMembership.mockRejectedValueOnce(Error('unavailable'));
    await send(callback(accept));
    expect(count('coach_client')).toBe(0);
    expect(latestMessage().text).toContain('Не удалось завершить');

    beforeBatch = (statements) => {
      if (statements.length === 4) throw Error('D1 unavailable');
    };
    await send(callback(accept));
    expect(count('coach_client')).toBe(0);
    expect(outbox().revision).toBe(1);

    beforeBatch = () => {};
    const update = callback(accept);
    notification.mockImplementationOnce(async () => Response.json({ ok: true, result: true }))
      .mockRejectedValueOnce(Error('lost response'));
    expect((await send(update)).status).toBe(503);
    expect(count('coach_client')).toBe(1);
    expect((await send(update)).status).toBe(200);
    expect(provisionInviteMembership).toHaveBeenCalledTimes(3);
    expect(outbox().revision).toBe(2);
  });

  it('reports accepted and pending when D1 commits the batch but loses the response', async () => {
    const { accept } = await show();
    afterBatch = (statements) => {
      if (statements.length === 4) throw Error('lost D1 response');
    };
    await send(callback(accept));
    expect(count('coach_client')).toBe(1);
    expect(outbox().revision).toBe(2);
    expect(latestMessage().text).toContain('Приглашение принято. Подготавливаем доступ.');
  });

  it('lets the first acceptance claim finish while a concurrent accept or cancel arrives', async () => {
    const { accept, cancel } = await show();
    let begin, finish;
    const started = new Promise(resolve => { begin = resolve; });
    provisionInviteMembership.mockImplementationOnce(() => {
      begin();
      return new Promise(resolve => { finish = resolve; });
    });
    const first = send(callback(accept));
    await started;
    await send(callback(accept));
    await send(callback(cancel));
    expect(provisionInviteMembership).toHaveBeenCalledTimes(1);
    finish({ realmId: 'rlmtest' });
    expect((await first).status).toBe(200);
    expect(count('coach_client')).toBe(1);
    expect(latestMessage().text).toContain('Приглашение принято!');
  });

  it('reports pending without reassigning rights and observes current acknowledgement after revocation', async () => {
    const { accept } = await show();
    replicate.mockResolvedValueOnce(Response.json({ status: 'applied', revision: 999 }));
    await send(callback(accept));
    const [[check]] = latestMessage().reply_markup.inline_keyboard;
    const backedOff = outbox();
    expect(check.text).toBe('Проверить готовность');
    expect(backedOff.last_error).toBe('INVALID_ACKNOWLEDGEMENT');
    run('UPDATE coach_client_invite SET revoked_at = CURRENT_TIMESTAMP');
    await send(callback(check.callback_data));
    expect(latestMessage().text).toContain('Подготавливаем доступ');
    expect(outbox()).toEqual(backedOff);

    const { deliverAccountReplicas } = await import('./lib/account-replication');
    now = backedOff.next_attempt_at;
    await deliverAccountReplicas(env, '202');
    await send(callback(check.callback_data));
    expect(latestMessage().text).toContain('Приглашение принято!');
    expect(provisionInviteMembership).toHaveBeenCalledTimes(1);

    const saved = env.MEZFIT_ACCOUNT_REPLICATION_SECRET;
    delete env.MEZFIT_ACCOUNT_REPLICATION_SECRET;
    await send(callback(check.callback_data));
    expect(latestMessage().text).toContain('Подготавливаем доступ');

    env.MEZFIT_ACCOUNT_REPLICATION_SECRET = saved;
    run("DELETE FROM account_replication_outbox WHERE telegram_user_id = '202'");
    await send(callback(check.callback_data));
    expect(latestMessage().text).toContain('Подготавливаем доступ');
    expect(outbox()).toBeUndefined();
  });

  it('uses login_url only for a ready registration after activation', async () => {
    env.TELEGRAM_BOT_LOGIN_URL_ENABLED = 'true';
    replicate.mockResolvedValueOnce(Response.json({ status: 'applied', revision: 999 }));
    await send(callback((await show()).accept));
    const [[check]] = latestMessage().reply_markup.inline_keyboard;
    expect(check).toEqual({ text: 'Проверить готовность', callback_data: expect.any(String) });
    const { deliverAccountReplicas } = await import('./lib/account-replication');
    now = outbox().next_attempt_at;
    await deliverAccountReplicas(env, '202');
    await send(callback(check.callback_data));
    expect(latestMessage().reply_markup.inline_keyboard[0][0]).toEqual({
      text: 'Открыть Mezfit', login_url: { url: 'https://mezfit.online/auth/telegram-login' },
    });
  });

  it('keeps a newer revision pending when a concurrent change outpaces immediate delivery', async () => {
    const { accept } = await show();
    replicate.mockImplementationOnce(async (snapshot) => {
      run("INSERT INTO user_role (user_id, role) VALUES (2, 'coach')");
      return Response.json({ status: 'applied', revision: snapshot.revision });
    });
    await send(callback(accept));
    expect(outbox()).toMatchObject({ revision: 3, next_attempt_at: expect.any(Number) });
    expect(latestMessage().text).toContain('Подготавливаем доступ');
  });
});
