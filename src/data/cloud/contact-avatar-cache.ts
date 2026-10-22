import { stableCloudRelationshipId } from '../../../shared/relationship-id';
import type { MezfitCloudDatabase } from './database';

export interface AvatarContactRef {
  relationshipId: string;
  userId: string;
  avatarVersion?: string | null;
}

export type AvatarTraceStage =
  | 'invalid-reference'
  | 'reading-dexie'
  | 'profile-not-found'
  | 'permission-version-changed'
  | 'blob-validated'
  | 'indexeddb-error';

/** Fixed stage labels only: never expose user IDs, blobs or signed Telegram data. */
export type AvatarTrace = (stage: AvatarTraceStage) => void;

/**
 * The authorized realm-scoped contact profile already contains the JPEG Blob.
 * Dexie Cloud Addon replicates it into IndexedDB; no HTTP media endpoint, R2,
 * separate IndexedDB database or manual download cache is necessary.
 */
export async function loadContactAvatar(
  db: Pick<MezfitCloudDatabase, 'contactProfiles'>,
  contact: AvatarContactRef,
  trace?: AvatarTrace,
): Promise<Blob | null> {
  const version = contact.avatarVersion;
  if (!version || !/^[a-f0-9]{64}$/.test(version)
    || !/^tg:[1-9][0-9]*$/.test(contact.userId)
    || !/^rlm[a-f0-9]{28}$/.test(contact.relationshipId)) {
    trace?.('invalid-reference');
    return null;
  }
  try {
    trace?.('reading-dexie');
    const profileId = await stableCloudRelationshipId(
      'prf', contact.relationshipId + ':' + contact.userId,
    );
    const profile = await db.contactProfiles.get(profileId);
    if (!profile || profile.realmId !== contact.relationshipId
      || profile.userId !== contact.userId || profile.owner !== null) {
      trace?.('profile-not-found');
      return null;
    }
    if (profile.avatarVersion !== version) {
      trace?.('permission-version-changed');
      return null;
    }
    const image = profile.avatar;
    if (!(image instanceof Blob) || image.size < 16 || image.size > 256_000) {
      trace?.('profile-not-found');
      return null;
    }
    trace?.('blob-validated');
    return image;
  } catch {
    trace?.('indexeddb-error');
    return null;
  }
}
