import { validateTelegramInitData, type TelegramInitUser } from './telegram';
import { stableCloudRelationshipId } from '../../shared/relationship-id';
import {
  cloudMembershipAdminRead,
  cloudMembershipAdminToken,
  cloudMembershipAdminUploadAvatar,
  cloudMembershipAdminUpsertProfiles,
  relationshipMembership,
  type CloudMembershipEnv,
} from './dexie-cloud-membership';

export interface ContactProfileEnv extends CloudMembershipEnv {
  TELEGRAM_BOT_TOKEN: string;
}

type Row = Record<string, unknown>;

function record(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function accepted(value: unknown): boolean {
  return value === true || value instanceof Date && Number.isFinite(value.getTime())
    || typeof value === 'string' && Number.isFinite(Date.parse(value))
    || record(value) && value.$t === 'Date'
      && typeof value.v === 'string' && Number.isFinite(Date.parse(value.v));
}

function exactRole(value: unknown, role: 'coach' | 'client'): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === role;
}

function validMember(value: Row, id: string, userId: string, role: 'coach' | 'client'): boolean {
  return value.id === id && value.userId === userId && value.owner === null
    && exactRole(value.roles, role) && value.invite !== true && accepted(value.accepted)
    && (value.permissions == null
      || record(value.permissions) && Object.keys(value.permissions).length === 0);
}

function userId(value: unknown): value is string {
  return typeof value === 'string' && /^tg:[1-9][0-9]*$/.test(value)
    && Number.isSafeInteger(Number(value.slice(3)));
}

function realmId(value: unknown): value is string {
  return typeof value === 'string' && /^rlm[a-f0-9]{28}$/.test(value);
}

function version(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function sha(input: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getJson(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error('TELEGRAM_PROFILE_UNAVAILABLE');
  return response.json() as Promise<unknown>;
}

type Photo = { fileId: string; version: string } | null;

/** The Bot API can report no visible avatar; on transport failure preserve the last good version. */
async function currentTelegramPhoto(
  fetchImpl: typeof fetch, botToken: string, telegramId: number,
): Promise<Photo | undefined> {
  try {
    const result = await getJson(fetchImpl, `https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: telegramId, offset: 0, limit: 1 }),
    });
    if (!record(result) || result.ok !== true || !record(result.result)
      || !Array.isArray(result.result.photos)) return undefined;
    const photos = result.result.photos;
    if (photos.length === 0) return null;
    const sizes = photos[0];
    if (!Array.isArray(sizes) || sizes.length === 0) return undefined;
    const last = sizes[sizes.length - 1];
    if (!record(last) || typeof last.file_id !== 'string'
      || typeof last.file_unique_id !== 'string') return undefined;
    return { fileId: last.file_id, version: await sha(last.file_unique_id) };
  } catch {
    return undefined;
  }
}

/**
 * The only avatar storage is Dexie Cloud's authenticated blob service.
 * BlobRefs are attached to relationship-scoped profile rows with _hasBlobRefs.
 */
function cloudAvatar(value: unknown): boolean {
  return record(value) && (
    value._bt === 'Blob' && typeof value.ref === 'string'
    || value.$t === 'Blob' && typeof value.v === 'string'
  );
}

async function fetchTelegramAvatar(
  fetchImpl: typeof fetch, botToken: string, photo: Exclude<Photo, null>,
): Promise<ArrayBuffer | null> {
  try {
    const result = await getJson(fetchImpl, `https://api.telegram.org/bot${botToken}/getFile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: photo.fileId }),
    });
    if (!record(result) || result.ok !== true || !record(result.result)
      || typeof result.result.file_path !== 'string') return null;
    const filePath = result.result.file_path;
    if (!/^[A-Za-z0-9_./-]+$/.test(filePath) || filePath.includes('..')) return null;
    const image = await fetchImpl(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!image.ok || Number(image.headers.get('content-length') || 0) > 256_000) return null;
    const bytes = await image.arrayBuffer();
    const signature = new Uint8Array(bytes);
    if (signature.length < 16 || signature.length > 256_000
      || signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) return null;
    return bytes;
  } catch {
    return null;
  }
}

export async function validatedPair(
  fetchImpl: typeof fetch, bearer: string, id: string,
): Promise<Row[] | null> {
  const [realm, value] = await Promise.all([
    cloudMembershipAdminRead(fetchImpl, bearer, '/all/realms/' + encodeURIComponent(id)),
    cloudMembershipAdminRead(fetchImpl, bearer, '/all/members?realmId=' + encodeURIComponent(id)),
  ]);
  if (!record(realm) || realm.realmId !== id || realm.owner !== null
    || realm.name !== 'Mezfit coach-client pilot'
    || !Array.isArray(value) || value.length !== 2 || !value.every(record)) return null;
  const rows: Row[] = value;
  const coach = rows.find((row) => exactRole(row.roles, 'coach'));
  const client = rows.find((row) => exactRole(row.roles, 'client'));
  if (!coach || !client || !userId(coach.userId) || !userId(client.userId)) return null;
  const expected = await relationshipMembership(coach.userId.slice(3), client.userId.slice(3));
  if (expected.realm.realmId !== id || coach.realmId !== id || client.realmId !== id
    || !validMember(coach, expected.members[0].id, expected.members[0].userId, 'coach')
    || !validMember(client, expected.members[1].id, expected.members[1].userId, 'client')) return null;
  return rows;
}

/** Later verified Telegram launches take precedence over older still-valid initData. */
function hasNewerOrSameSource(row: Row | undefined, sourceAuthAt: number): boolean {
  return typeof row?.sourceAuthAt === 'number' && Number.isSafeInteger(row.sourceAuthAt)
    && row.sourceAuthAt >= sourceAuthAt;
}

function profileName(user: TelegramInitUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim().slice(0, 120);
}

function error(status: number, code: string): Response {
  return Response.json({ error: { code, message: 'Не удалось обновить профиль' } }, {
    status, headers: { 'cache-control': 'no-store' },
  });
}

/** Privileged, change-only refresh of the signed user's own relationship labels. */
export async function syncOwnContactProfile(
  request: Request, env: ContactProfileEnv, fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED');
  const identity = await validateTelegramInitData(
    request.headers.get('x-telegram-init-data') ?? '', env.TELEGRAM_BOT_TOKEN,
  );
  const account = 'tg:' + identity.user.id;
  const sourceAuthAt = identity.authDate.getTime();
  if (!Number.isSafeInteger(sourceAuthAt) || sourceAuthAt <= 0) {
    return error(401, 'INVALID_PROFILE_SOURCE');
  }
  const bearer = await cloudMembershipAdminToken(env, fetchImpl);
  const own = await cloudMembershipAdminRead(
    fetchImpl, bearer, '/all/members?userId=' + encodeURIComponent(account),
  );
  if (!Array.isArray(own) || !own.every(record)) return error(502, 'CLOUD_PROFILE_UNAVAILABLE');

  const eligible: Array<{ realmId: string; id: string }> = [];
  for (const member of own) {
    if (!realmId(member.realmId)) continue;
    const pair = await validatedPair(fetchImpl, bearer, member.realmId);
    const self = pair?.find((row) => row.userId === account && row.id === member.id);
    if (self) eligible.push({
      realmId: member.realmId,
      id: await stableCloudRelationshipId('prf', member.realmId + ':' + account),
    });
  }
  if (eligible.length === 0) {
    return Response.json({ changed: false }, { headers: { 'cache-control': 'no-store' } });
  }

  // Profile rows are separate from system-managed access memberships. REST upserts
  // must never replace member records: doing so could resurrect a revoked grant.
  const existing = await cloudMembershipAdminRead(
    fetchImpl, bearer, '/all/contactProfiles?userId=' + encodeURIComponent(account),
  );
  if (!Array.isArray(existing) || !existing.every(record)) return error(502, 'CLOUD_PROFILE_UNAVAILABLE');
  const known = new Map(existing.filter((row) => typeof row.id === 'string')
    .map((row) => [row.id as string, row]));

  const eligibleForSession = eligible.filter(({ id }) =>
    !hasNewerOrSameSource(known.get(id), sourceAuthAt));
  if (eligibleForSession.length === 0) {
    return Response.json({ changed: false }, { headers: { 'cache-control': 'no-store' } });
  }

  const name = profileName(identity.user);
  const photo = await currentTelegramPhoto(fetchImpl, env.TELEGRAM_BOT_TOKEN, identity.user.id);
  const hasNewVersion = photo !== undefined && eligibleForSession.some(({ id }) =>
    known.get(id)?.avatarVersion !== (photo?.version ?? null)
    || (photo !== null && !cloudAvatar(known.get(id)?.avatar)));
  let newVersion: string | null | undefined;
  let newAvatar: Row | null | undefined;
  if (photo === null) {
    newVersion = null;
    newAvatar = null;
  } else if (photo && hasNewVersion) {
    const downloaded = await fetchTelegramAvatar(fetchImpl, env.TELEGRAM_BOT_TOKEN, photo);
    if (downloaded) {
      try {
        const id = await sha(account + ':' + photo.version);
        newAvatar = await cloudMembershipAdminUploadAvatar(fetchImpl, bearer, id, downloaded);
        newVersion = photo.version;
      } catch {
        // Keep the last valid version; a later verified launch can retry.
      }
    }
  }

  // The Telegram Bot API calls above may take time. Re-read cloud timestamps
  // just before committing so a slower, older Mini App session does not
  // restore a name that a newer session has already persisted.
  const latest = await cloudMembershipAdminRead(
    fetchImpl, bearer, '/all/contactProfiles?userId=' + encodeURIComponent(account),
  );
  if (!Array.isArray(latest) || !latest.every(record)) return error(502, 'CLOUD_PROFILE_UNAVAILABLE');
  const current = new Map(latest.filter((row) => typeof row.id === 'string')
    .map((row) => [row.id as string, row]));

  const changed: Row[] = [];
  for (const entry of eligibleForSession) {
    const previous = current.get(entry.id);
    if (hasNewerOrSameSource(previous, sourceAuthAt)) continue;
    if (previous && (previous.realmId !== entry.realmId || previous.userId !== account
      || previous.owner !== null)) continue;
    const previousAvatar = cloudAvatar(previous?.avatar) ? previous?.avatar : null;
    const avatarVersion = newVersion === undefined
      ? (previousAvatar && version(previous?.avatarVersion) ? previous.avatarVersion : null)
      : newVersion;
    const avatar = newAvatar === undefined ? previousAvatar : newAvatar;
    const isBlobRef = record(avatar) && avatar._bt === 'Blob';
    if (previous?.name === name && previous.avatarVersion === avatarVersion
      && (avatarVersion === null || cloudAvatar(previous.avatar))) continue;
    changed.push({
      id: entry.id,
      realmId: entry.realmId,
      owner: null,
      userId: account,
      name,
      avatarVersion,
      avatar,
      ...(isBlobRef ? { _hasBlobRefs: 1 } : {}),
      sourceAuthAt,
    });
  }
  await cloudMembershipAdminUpsertProfiles(fetchImpl, bearer, changed);
  return Response.json({ changed: changed.length > 0 }, { headers: { 'cache-control': 'no-store' } });
}

