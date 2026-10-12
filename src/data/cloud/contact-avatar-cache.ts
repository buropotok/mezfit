import Dexie, { type Table } from 'dexie';
import { fetchCloudContactAvatar } from '../../api';

export interface AvatarContactRef {
  relationshipId: string;
  userId: string;
  avatarVersion?: string | null;
}

interface AvatarCacheEntry {
  userId: string;
  version: string;
  blob: Blob;
}

class AvatarCacheDatabase extends Dexie {
  files!: Table<AvatarCacheEntry, string>;

  constructor(telegramUserId: string) {
    super('mezfit-avatar-cache:' + telegramUserId);
    this.version(1).stores({ files: '&userId' });
  }
}

const downloads = new Map<string, Promise<Blob | null>>();

/**
 * Account-scoped, local-only media cache. Not part of cloud business replication.
 * A version match returns stored bytes without a network request or local write.
 */
export async function loadContactAvatar(
  telegramUserId: string,
  initData: string,
  contact: AvatarContactRef,
): Promise<Blob | null> {
  const version = contact.avatarVersion;
  if (!version || !/^[a-f0-9]{64}$/.test(version)
    || !/^tg:[1-9][0-9]*$/.test(contact.userId)
    || !/^rlm[a-f0-9]{28}$/.test(contact.relationshipId)) return null;

  const key = [telegramUserId, contact.userId, version].join(':');
  const existing = downloads.get(key);
  if (existing) return existing;

  const task = (async () => {
    const db = new AvatarCacheDatabase(telegramUserId);
    try {
      const saved = await db.files.get(contact.userId);
      if (saved?.version === version && saved.blob instanceof Blob) return saved.blob;

      const image = await fetchCloudContactAvatar(
        initData, contact.relationshipId, contact.userId, version,
      );
      await db.files.put({ userId: contact.userId, version, blob: image });
      return image;
    } catch {
      // Missing network/media should never block the contact or reveal old photos.
      return null;
    } finally {
      db.close();
    }
  })();

  downloads.set(key, task);
  try {
    return await task;
  } finally {
    downloads.delete(key);
  }
}

/** After a confirmed cloud pull, evict portraits from revoked relationships or old versions. */
export async function pruneUnlinkedContactAvatars(
  telegramUserId: string,
  contacts: readonly AvatarContactRef[],
): Promise<void> {
  const permitted = new Map(contacts.map((contact) => [contact.userId, contact.avatarVersion]));
  const db = new AvatarCacheDatabase(telegramUserId);
  try {
    const rows = await db.files.toArray();
    await Promise.all(rows.filter((row) => permitted.get(row.userId) !== row.version)
      .map((row) => db.files.delete(row.userId)));
  } catch {
    // Media cleanup is best effort; never block a valid relationship list.
  } finally {
    db.close();
  }
}
