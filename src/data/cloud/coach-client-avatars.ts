import type { MezfitCloudDatabase } from './database';

/**
 * A coach's private contact portrait. It is not the client's own profile:
 * the record belongs to the coach's personal Dexie Cloud realm and only
 * affects that coach's directory, calendar and client workspace.
 */
export interface CoachClientAvatarRow {
  id: string;
  realmId: string;
  owner?: string | null;
  relationshipId: string;
  clientUserId: string;
  version: string;
  avatarSmall: Blob;
  avatarLarge: Blob;
}

export interface CoachAvatarTarget {
  relationshipId: string;
  userId: string;
}

function assertTarget(actorUserId: string, target: CoachAvatarTarget): void {
  if (!/^tg:[1-9][0-9]*$/.test(actorUserId)
    || !/^tg:[1-9][0-9]*$/.test(target.userId)
    || target.userId === actorUserId
    || !/^rlm[a-f0-9]{28}$/.test(target.relationshipId)) {
    throw new Error('INVALID_COACH_AVATAR_TARGET');
  }
}

function avatarRowId(target: CoachAvatarTarget): string {
  return 'coach-client-avatar:' + target.relationshipId;
}

/** Ordinary local-first Dexie writes; the Addon handles Blob upload and sync. */
export class CoachClientAvatarRepository {
  constructor(private readonly db: Pick<MezfitCloudDatabase, 'coachClientAvatars'>,
    private readonly actorUserId: string) {}

  async save(target: CoachAvatarTarget, small: Blob, large: Blob): Promise<void> {
    assertTarget(this.actorUserId, target);
    if (small.type !== 'image/jpeg' || large.type !== 'image/jpeg'
      || small.size < 16 || large.size < 16
      || small.size > 50_000 || large.size > 245_000) {
      throw new Error('INVALID_COACH_AVATAR_IMAGE');
    }
    await this.db.coachClientAvatars.put({
      id: avatarRowId(target),
      realmId: this.actorUserId,
      owner: this.actorUserId,
      relationshipId: target.relationshipId,
      clientUserId: target.userId,
      version: crypto.randomUUID(),
      avatarSmall: small,
      avatarLarge: large,
    });
  }

  async remove(target: CoachAvatarTarget): Promise<void> {
    assertTarget(this.actorUserId, target);
    const id = avatarRowId(target);
    const current = await this.db.coachClientAvatars.get(id);
    if (!current) return;
    if (!isOwnCoachClientAvatar(current, this.actorUserId, target)) {
      throw new Error('INVALID_COACH_AVATAR_OWNER');
    }
    await this.db.coachClientAvatars.delete(id);
  }

  async load(target: CoachAvatarTarget, version: string, variant: 'small' | 'large' = 'small'): Promise<Blob | null> {
    assertTarget(this.actorUserId, target);
    const current = await this.db.coachClientAvatars.get(avatarRowId(target));
    if (!current || !isOwnCoachClientAvatar(current, this.actorUserId, target)
      || current.version !== version) return null;
    const blob = variant === 'large' ? current.avatarLarge : current.avatarSmall;
    const limit = variant === 'large' ? 245_000 : 50_000;
    return blob instanceof Blob && blob.type === 'image/jpeg' && blob.size >= 16
      && blob.size <= limit ? blob : null;
  }
}

export function isOwnCoachClientAvatar(
  row: CoachClientAvatarRow, actorUserId: string, target: CoachAvatarTarget,
): boolean {
  return row.id === avatarRowId(target) && row.realmId === actorUserId
    && row.owner === actorUserId && row.relationshipId === target.relationshipId
    && row.clientUserId === target.userId
    && typeof row.version === 'string' && /^[a-f0-9-]{36}$/.test(row.version);
}
