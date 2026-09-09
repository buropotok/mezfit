import { createExerciseForClient, hasActiveCoachClient, listExercisesForClient, type TrackingType } from './lib/exercises';
import { createOpaqueToken, sha256Hex } from './lib/tokens';
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

interface AuthContext {
  row: UserRow;
  roles: Role[];
  startParam?: string;
}

interface InviteRow {
  id: number;
  coach_user_id: number;
  label: string | null;
  expires_at: string;
  coach_first_name: string;
  coach_last_name: string | null;
  coach_username: string | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
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

async function requireUser(request: Request, env: Env): Promise<AuthContext> {
  const initData = request.headers.get('x-telegram-init-data') ?? '';
  const validated = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const row = await upsertUser(env.DB_BINDING, validated.user);
  return {
    row,
    roles: await getRoles(env.DB_BINDING, row.id),
    startParam: validated.startParam,
  };
}

function requireRole(auth: AuthContext, role: Role): void {
  if (!auth.roles.includes(role)) {
    throw new HttpError(403, 'ROLE_REQUIRED', `${role} role is required`);
  }
}

async function requireCoachClient(db: D1Database, coachUserId: number, clientUserId: number): Promise<void> {
  if (!(await hasActiveCoachClient(db, coachUserId, clientUserId))) {
    throw new HttpError(404, 'CLIENT_NOT_FOUND', 'Client is not linked to this coach');
  }
}

function inviteTokenFromStartParam(startParam?: string): string | null {
  if (!startParam?.startsWith('invite_')) return null;
  const token = startParam.slice('invite_'.length);
  return /^[a-f0-9]{36}$/i.test(token) ? token.toLowerCase() : null;
}

async function findInvite(db: D1Database, token: string): Promise<InviteRow | null> {
  const tokenHash = await sha256Hex(token);
  return db
    .prepare(`
      SELECT
        i.id,
        i.coach_user_id,
        i.label,
        i.expires_at,
        coach.first_name AS coach_first_name,
        coach.last_name AS coach_last_name,
        coach.username AS coach_username
      FROM coach_client_invite i
      JOIN app_user coach ON coach.id = i.coach_user_id
      WHERE i.token_hash = ?
        AND i.accepted_at IS NULL
        AND i.expires_at > CURRENT_TIMESTAMP
    `)
    .bind(tokenHash)
    .first<InviteRow>();
}

const trackingTypes = new Set<TrackingType>(['weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight']);

function isTrackingType(value: unknown): value is TrackingType {
  return typeof value === 'string' && trackingTypes.has(value as TrackingType);
}

async function handleExerciseRoute(request: Request, env: Env, clientUserId: number): Promise<Response> {
  const auth = await requireUser(request, env);
  requireRole(auth, 'coach');
  await requireCoachClient(env.DB_BINDING, auth.row.id, clientUserId);

  const url = new URL(request.url);
  if (request.method === 'GET') {
    const search = (url.searchParams.get('search') ?? '').trim().slice(0, 100);
    const exercises = await listExercisesForClient(env.DB_BINDING, auth.row.id, clientUserId, search);
    return json({ exercises });
  }

  if (request.method === 'POST') {
    let body: {
      scope?: unknown;
      name?: unknown;
      trackingType?: unknown;
      primaryMuscle?: unknown;
      equipment?: unknown;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (body.scope !== 'coach' && body.scope !== 'client') {
      throw new HttpError(400, 'INVALID_SCOPE', 'Exercise scope must be coach or client');
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) throw new HttpError(400, 'INVALID_NAME', 'Exercise name is required');
    if (!isTrackingType(body.trackingType)) {
      throw new HttpError(400, 'INVALID_TRACKING_TYPE', 'Unsupported exercise tracking type');
    }

    const primaryMuscle = typeof body.primaryMuscle === 'string' ? body.primaryMuscle.trim().slice(0, 80) || null : null;
    const equipment = typeof body.equipment === 'string' ? body.equipment.trim().slice(0, 80) || null : null;
    const exercise = await createExerciseForClient(env.DB_BINDING, auth.row.id, clientUserId, {
      scope: body.scope,
      name,
      trackingType: body.trackingType,
      primaryMuscle,
      equipment,
    });

    if (!exercise) throw new HttpError(409, 'EXERCISE_EXISTS', 'An exercise with this name already exists in this scope');
    return json({ exercise }, { status: 201 });
  }

  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const exerciseMatch = url.pathname.match(/^\/api\/coach\/clients\/(\d+)\/exercises$/);
  if (exerciseMatch) return handleExerciseRoute(request, env, Number(exerciseMatch[1]));

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
    const auth = await requireUser(request, env);
    return json({ user: userView(auth.row), roles: auth.roles });
  }

  if (url.pathname === '/api/me/roles' && request.method === 'POST') {
    const auth = await requireUser(request, env);
    let body: { role?: string } = {};
    try {
      body = (await request.json()) as { role?: string };
    } catch {
      // Validation below returns a stable 400 response.
    }

    if (body.role !== 'coach' && body.role !== 'client') {
      throw new HttpError(400, 'INVALID_ROLE', 'Role must be coach or client');
    }

    await env.DB_BINDING
      .prepare('INSERT OR IGNORE INTO user_role (user_id, role) VALUES (?, ?)')
      .bind(auth.row.id, body.role)
      .run();

    return json({ user: userView(auth.row), roles: await getRoles(env.DB_BINDING, auth.row.id) });
  }

  if (url.pathname === '/api/coach/clients' && request.method === 'GET') {
    const auth = await requireUser(request, env);
    requireRole(auth, 'coach');

    const result = await env.DB_BINDING
      .prepare(`
        SELECT
          cc.id AS relationship_id,
          client.id,
          client.telegram_user_id,
          client.username,
          client.first_name,
          client.last_name,
          client.language_code,
          client.photo_url,
          client.is_premium
        FROM coach_client cc
        JOIN app_user client ON client.id = cc.client_user_id
        WHERE cc.coach_user_id = ? AND cc.status = 'active'
        ORDER BY COALESCE(client.last_name, ''), client.first_name, client.id
      `)
      .bind(auth.row.id)
      .all<UserRow & { relationship_id: number }>();

    return json({
      clients: result.results.map((row) => ({ relationshipId: row.relationship_id, user: userView(row) })),
    });
  }

  if (url.pathname === '/api/coach/client-invites' && request.method === 'POST') {
    const auth = await requireUser(request, env);
    requireRole(auth, 'coach');

    let body: { label?: string } = {};
    try {
      body = (await request.json()) as { label?: string };
    } catch {
      // An empty label is allowed.
    }
    const label = body.label?.trim().slice(0, 120) || null;
    const token = createOpaqueToken();
    const tokenHash = await sha256Hex(token);

    await env.DB_BINDING
      .prepare(`
        INSERT INTO coach_client_invite (coach_user_id, token_hash, label, expires_at)
        VALUES (?, ?, ?, datetime('now', '+30 days'))
      `)
      .bind(auth.row.id, tokenHash, label)
      .run();

    const startParam = `invite_${token}`;
    return json({
      startParam,
      telegramUrl: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=${startParam}`,
      expiresInDays: 30,
    }, { status: 201 });
  }

  if (url.pathname === '/api/invite/current' && request.method === 'GET') {
    const auth = await requireUser(request, env);
    const token = inviteTokenFromStartParam(auth.startParam);
    if (!token) return json({ invite: null });

    const invite = await findInvite(env.DB_BINDING, token);
    if (!invite || invite.coach_user_id === auth.row.id) return json({ invite: null });

    return json({
      invite: {
        label: invite.label,
        expiresAt: invite.expires_at,
        coach: {
          firstName: invite.coach_first_name,
          lastName: invite.coach_last_name,
          username: invite.coach_username,
        },
      },
    });
  }

  if (url.pathname === '/api/invite/current/accept' && request.method === 'POST') {
    const auth = await requireUser(request, env);
    const token = inviteTokenFromStartParam(auth.startParam);
    if (!token) throw new HttpError(400, 'INVITE_MISSING', 'No invite is attached to this Mini App launch');

    const invite = await findInvite(env.DB_BINDING, token);
    if (!invite) throw new HttpError(410, 'INVITE_UNAVAILABLE', 'Invite is invalid, expired, or already used');
    if (invite.coach_user_id === auth.row.id) throw new HttpError(400, 'SELF_LINK', 'Coach cannot accept their own invite');

    await env.DB_BINDING.batch([
      env.DB_BINDING
        .prepare(`
          INSERT INTO coach_client (coach_user_id, client_user_id, invite_id)
          VALUES (?, ?, ?)
          ON CONFLICT(coach_user_id, client_user_id) DO UPDATE SET
            status = 'active',
            updated_at = CURRENT_TIMESTAMP
        `)
        .bind(invite.coach_user_id, auth.row.id, invite.id),
      env.DB_BINDING
        .prepare(`
          UPDATE coach_client_invite
          SET accepted_by_user_id = ?, accepted_at = CURRENT_TIMESTAMP
          WHERE id = ? AND accepted_at IS NULL
        `)
        .bind(auth.row.id, invite.id),
      env.DB_BINDING
        .prepare("INSERT OR IGNORE INTO user_role (user_id, role) VALUES (?, 'client')")
        .bind(auth.row.id),
    ]);

    return json({ ok: true, roles: await getRoles(env.DB_BINDING, auth.row.id) });
  }

  throw new HttpError(404, 'NOT_FOUND', 'API route not found');
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
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, { status: error.status });
      }

      console.error('Unhandled API error', error);
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
