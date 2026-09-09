import { TelegramAuthError, validateTelegramInitData, type TelegramInitUser } from './lib/telegram';

type Role = 'coach' | 'client';

interface UserRow {
  id: number;
  telegram_user_id: string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  language_code: string | null;
  photo_url: string | null;
  is_premium: number;
}

interface UserView {
  id: number;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isPremium: boolean;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function userView(row: UserRow): UserView {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    languageCode: row.language_code,
    photoUrl: row.photo_url,
    isPremium: row.is_premium === 1,
  };
}

async function upsertUser(db: D1Database, telegramUser: TelegramInitUser): Promise<UserRow> {
  await db
    .prepare(`
      INSERT INTO app_user (
        telegram_user_id, username, first_name, last_name, language_code, photo_url, is_premium
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        language_code = excluded.language_code,
        photo_url = excluded.photo_url,
        is_premium = excluded.is_premium,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(
      String(telegramUser.id),
      telegramUser.username ?? null,
      telegramUser.first_name,
      telegramUser.last_name ?? null,
      telegramUser.language_code ?? null,
      telegramUser.photo_url ?? null,
      telegramUser.is_premium ? 1 : 0,
    )
    .run();

  const row = await db
    .prepare(`
      SELECT id, telegram_user_id, username, first_name, last_name, language_code, photo_url, is_premium
      FROM app_user
      WHERE telegram_user_id = ?
    `)
    .bind(String(telegramUser.id))
    .first<UserRow>();

  if (!row) throw new Error('Failed to resolve persisted user');
  return row;
}

async function getRoles(db: D1Database, userId: number): Promise<Role[]> {
  const result = await db
    .prepare('SELECT role FROM user_role WHERE user_id = ? ORDER BY role')
    .bind(userId)
    .all<{ role: Role }>();
  return result.results.map(({ role }) => role);
}

async function requireUser(request: Request, env: Env): Promise<{ row: UserRow; roles: Role[] }> {
  const initData = request.headers.get('x-telegram-init-data') ?? '';
  const validated = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertUser(env.DB_BINDING, validated.user);
  return { row, roles: await getRoles(env.DB_BINDING, row.id) };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health' && request.method === 'GET') {
    const result = await env.DB_BINDING.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return json({
      ok: result?.ok === 1,
      service: 'mezfit',
      d1: result?.ok === 1 ? 'connected' : 'unexpected',
      r2: env.R2_BINDING_MEZFIT ? 'bound' : 'missing',
    });
  }

  if (url.pathname === '/api/me' && request.method === 'GET') {
    const { row, roles } = await requireUser(request, env);
    return json({ user: userView(row), roles });
  }

  if (url.pathname === '/api/me/roles' && request.method === 'POST') {
    const { row } = await requireUser(request, env);
    let body: { role?: string } = {};
    try {
      body = (await request.json()) as { role?: string };
    } catch {
      // Validation below returns a stable 400 response.
    }

    if (body.role !== 'coach' && body.role !== 'client') {
      return json({ error: { code: 'INVALID_ROLE', message: 'Role must be coach or client' } }, { status: 400 });
    }

    await env.DB_BINDING
      .prepare('INSERT OR IGNORE INTO user_role (user_id, role) VALUES (?, ?)')
      .bind(row.id, body.role)
      .run();

    return json({ user: userView(row), roles: await getRoles(env.DB_BINDING, row.id) });
  }

  return json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        return json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
      }

      console.error('Unhandled API error', error);
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
