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

interface AllowedAvatar {
  userId: string;
  version: string | null;
}

class AvatarCacheDatabase extends Dexie {
  files!: Table<AvatarCacheEntry, string>;
  allowed!: Table<AllowedAvatar, string>;

  constructor(telegramUserId: string) {
    super('mezfit-avatar-cache:' + telegramUserId);
    this.version(1).stores({ files: '&userId' });
    this.version(2).stores({ files: '&userId', allowed: '&userId' });
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
      // The latest verified contact snapshot is authoritative for media caching.
      const allowed = await db.allowed.get(contact.userId);
      if (allowed?.version !== version) return null;
      const saved = await db.files.get(contact.userId);
      if (saved?.version === version && saved.blob instanceof Blob) return saved.blob;

      const image = await fetchCloudContactAvatar(
        initData, contact.relationshipId, contact.userId, version,
      );
      // A newer pull can revoke access or change the version during this fetch.
      // Re-check and commit atomically with pruning to prevent reintroducing old bytes.
      return db.transaction('rw', db.files, db.allowed, async () => {
        const current = await db.allowed.get(contact.userId);
        if (current?.version !== version) return null;
        const latest = await db.files.get(contact.userId);
        if (latest?.version === version && latest.blob instanceof Blob) return latest.blob;
        await db.files.put({ userId: contact.userId, version, blob: image });
        return image;
      });
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
  const permitted = new Map(contacts
    .filter((contact) => /^tg:[1-9][0-9]*$/.test(contact.userId))
    .map((contact) => [contact.userId, contact.avatarVersion ?? null]));
  const db = new AvatarCacheDatabase(telegramUserId);
  try {
    await db.transaction('rw', db.files, db.allowed, async () => {
      const [files, previouslyAllowed] = await Promise.all([
        db.files.toArray(), db.allowed.toArray(),
      ]);
      const known = new Map(previouslyAllowed.map((row) => [row.userId, row.version]));
      for (const old of previouslyAllowed) {
        if (!permitted.has(old.userId)) await db.allowed.delete(old.userId);
      }
      for (const [userId, version] of permitted) {
        if (known.get(userId) !== version) await db.allowed.put({ userId, version });
      }
      for (const row of files) {
        if (permitted.get(row.userId) !== row.version) await db.files.delete(row.userId);
      }
    });
  } finally {
    db.close();
  }
}
