import { createOpaqueToken } from './tokens';

const DAY_MS = 86_400_000;

export interface InviteConsent {
  id: string;
  state: 'offered' | 'cancelled' | 'accepting' | 'accepted';
  token_hash: string;
}

export async function openInviteConsent(
  db: D1Database, actor: string, messageId: number, inviteId: number, messageDate: number,
): Promise<InviteConsent | null> {
  const now = Date.now();
  const expires = messageDate * 1000 + DAY_MS;
  if (expires <= now) return null;
  const results = await db.batch<InviteConsent>([
    db.prepare('DELETE FROM telegram_invite_consent WHERE expires_at <= ? AND claim_until <= ?').bind(now, now),
    db.prepare(`
      INSERT INTO telegram_invite_consent (id, telegram_user_id, start_message_id, invite_id, expires_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (telegram_user_id, start_message_id) DO NOTHING
    `).bind(createOpaqueToken(16), actor, messageId, inviteId, expires),
    db.prepare(`
      SELECT c.id, c.state, i.token_hash FROM telegram_invite_consent c
      JOIN coach_client_invite i ON i.id = c.invite_id
      WHERE c.telegram_user_id = ? AND c.start_message_id = ? AND c.invite_id = ? AND c.expires_at > ?
    `).bind(actor, messageId, inviteId, now),
  ]);
  return results[2].results[0] ?? null;
}

export function readInviteConsent(db: D1Database, id: string, actor: string): Promise<InviteConsent | null> {
  return db.prepare(`
    SELECT c.id, c.state, i.token_hash FROM telegram_invite_consent c
    JOIN coach_client_invite i ON i.id = c.invite_id
    WHERE c.id = ? AND c.telegram_user_id = ? AND c.expires_at > ?
  `).bind(id, actor, Date.now()).first<InviteConsent>();
}

export async function cancelInviteConsent(db: D1Database, id: string, actor: string): Promise<void> {
  await db.prepare(`
    UPDATE telegram_invite_consent SET state = 'cancelled'
    WHERE id = ? AND telegram_user_id = ? AND state = 'offered' AND expires_at > ?
  `).bind(id, actor, Date.now()).run();
}

export async function claimInviteConsent(db: D1Database, id: string, actor: string): Promise<number | null> {
  const now = Date.now();
  const claimUntil = now + 60_000;
  const result = await db.prepare(`
    UPDATE telegram_invite_consent SET state = 'accepting', claim_until = ?
    WHERE id = ? AND telegram_user_id = ? AND state IN ('offered', 'accepting')
      AND claim_until <= ? AND expires_at > ?
  `).bind(claimUntil, id, actor, now, now).run();
  return result.meta.changes === 1 ? claimUntil : null;
}

export async function releaseInviteClaim(db: D1Database, id: string, claimUntil: number): Promise<void> {
  await db.prepare(`
    UPDATE telegram_invite_consent SET claim_until = 0
    WHERE id = ? AND state = 'accepting' AND claim_until = ?
  `).bind(id, claimUntil).run();
}

export function completeInviteConsent(db: D1Database, id: string, actor: string): D1PreparedStatement {
  return db.prepare(`
    UPDATE telegram_invite_consent SET state = 'accepted', claim_until = 0, expires_at = ?
    WHERE id = ? AND telegram_user_id = ? AND state = 'accepting'
  `).bind(Date.now() + 30 * DAY_MS, id, actor);
}

export async function inviteRegistrationStatus(env: Env, consentId: string, actor: string) {
  const result = await env.DB_BINDING.prepare(`
    SELECT coach.first_name, coach.last_name, o.revision, o.next_attempt_at
    FROM telegram_invite_consent c
    JOIN coach_client_invite i ON i.id = c.invite_id
    JOIN app_user coach ON coach.id = i.coach_user_id
    JOIN app_user client ON client.telegram_user_id = c.telegram_user_id
    JOIN coach_client cc ON cc.coach_user_id = coach.id AND cc.client_user_id = client.id AND cc.status = 'active'
    JOIN user_role r ON r.user_id = client.id AND r.role = 'client'
    LEFT JOIN account_replication_outbox o ON o.telegram_user_id = client.telegram_user_id
    WHERE c.id = ? AND c.telegram_user_id = ? AND c.state = 'accepted' AND c.expires_at > ?
  `).bind(consentId, actor, Date.now()).first<{
    first_name: string;
    last_name: string | null;
    revision: number | null;
    next_attempt_at: number | null;
  }>();
  if (!result) return null;
  return {
    coachName: [result.first_name, result.last_name].filter(Boolean).join(' '),
    ready: Boolean(env.MEZFIT_ACCOUNT_REPLICATION_SECRET && result.revision !== null && result.next_attempt_at === null),
  };
}
