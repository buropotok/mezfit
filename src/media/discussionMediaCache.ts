import Dexie, { type Table } from 'dexie';
import { directMediaUrl } from './directMediaUpload';
import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaObjectSizeLimit } from '../../shared/discussion-media-limits';
import type { DiscussionPhotoPreview } from '../../shared/discussion-attachment';
import { signedDiscussionR2ReadUrl } from './cloudflareMediaRead';

/** Do not download very large clips merely because their thumbnail became visible. */
export const DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export interface DiscussionMediaCacheEntry {
  accountId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  /** Only published, realm-authorized attachments carry a remote read identity. */
  realmId?: string;
  messageId?: string;
  attachmentId?: string;
}

export interface MediaReplicaTask extends DiscussionMediaCacheEntry {
  fileName: string;
  yandexConfirmedAt?: string;
  r2ConfirmedAt?: string;
  published: boolean;
}

type StoredReplicaTask = Omit<MediaReplicaTask, 'accountId' | 'storageKey'> & { key: string };
export type MediaReplicaProvider = 'yandex' | 'r2';

class DiscussionMediaDatabase extends Dexie {
  files!: Table<{ key: string; blob: Blob }, string>;
  replicas!: Table<StoredReplicaTask, string>;

  constructor(accountId: string) {
    super(`mezfit-discussion-media:${accountId}`);
    this.version(1).stores({ files: '&key' });
    this.version(2).stores({ files: '&key', replicas: '&key' });
  }
}


/** Drop only disposable media bytes. Keep replica originals needed for upload recovery. */
export async function clearDiscussionMediaCache(accountId: string): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId)) throw new Error('INVALID_MEDIA_CACHE_ACCOUNT');
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const protectedKeys = new Set(await db.replicas.toCollection().primaryKeys());
    if (protectedKeys.size === 0) {
      await db.delete();
      return;
    }
    await db.transaction('rw', db.files, async () => {
      const keys = await db.files.toCollection().primaryKeys();
      await db.files.bulkDelete(keys.filter(key => !protectedKeys.has(key)));
    });
  } finally {
    db.close();
  }
}

function mediaUrl(entry: DiscussionMediaCacheEntry) {
  if (!/^tg:[1-9]\d*$/.test(entry.accountId) || !/^(image|video|audio)\//.test(entry.mimeType)
    || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0
    || entry.sizeBytes > discussionMediaObjectSizeLimit(entry.storageKey, entry.mimeType)) return null;
  return directMediaUrl(entry.storageKey);
}

function matches(entry: DiscussionMediaCacheEntry, blob: Blob) {
  return blob.size === entry.sizeBytes && blob.type.split(';', 1)[0] === entry.mimeType;
}

export async function readDiscussionMedia(entry: DiscussionMediaCacheEntry): Promise<Blob | null> {
  if (!mediaUrl(entry)) return null;
  const db = new DiscussionMediaDatabase(entry.accountId);
  try {
    const record = await db.files.get(entry.storageKey);
    return record?.blob instanceof Blob && matches(entry, record.blob) ? record.blob : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function storeDiscussionMedia(entry: DiscussionMediaCacheEntry, blob: Blob, required = false): Promise<void> {
  if (!mediaUrl(entry) || !matches(entry, blob)) {
    if (required) throw new Error('INVALID_LOCAL_MEDIA');
    return;
  }
  const db = new DiscussionMediaDatabase(entry.accountId);
  try {
    await db.files.put({ key: entry.storageKey, blob });
  } catch (reason) {
    if (required) throw reason;
    // Unavailable storage or an exhausted quota must not block sending or playback.
  } finally {
    db.close();
  }
}

export async function storeDiscussionPhoto(
  full: DiscussionMediaCacheEntry, file: Blob, preview: DiscussionPhotoPreview, thumbnail: Blob,
): Promise<void> {
  const previewEntry = { ...preview, accountId: full.accountId };
  const keys = photoReplicaKeys(full.storageKey);
  if (!keys || keys[0] !== full.storageKey || keys[1] !== preview.storageKey
    || !mediaUrl(full) || !matches(full, file) || !mediaUrl(previewEntry) || !matches(previewEntry, thumbnail)) {
    throw new Error('INVALID_LOCAL_MEDIA');
  }
  const db = new DiscussionMediaDatabase(full.accountId);
  try {
    await db.transaction('rw', db.files, () =>
      db.files.bulkPut([{ key: full.storageKey, blob: file }, { key: preview.storageKey, blob: thumbnail }]));
  } finally { db.close(); }
}

function photoReplicaKeys(storageKey: string): [string, string] | null {
  const match = DISCUSSION_MEDIA_KEY_PATTERN.exec(storageKey);
  if (!match?.[2]) return null;
  const prefix = `mvp-media/${match[1]}`;
  return [`${prefix}/full/${match[3]}`, `${prefix}/preview/${match[3]}`];
}

/** Called inside the replica transaction, so no retry can observe a deleted Full
 * together with incomplete replication state. */
async function cleanCompletedPhoto(db: DiscussionMediaDatabase, keys: [string, string]): Promise<void> {
  const [full, preview] = await db.replicas.bulkGet(keys);
  if (!full?.published || !preview?.published || !full.yandexConfirmedAt || !full.r2ConfirmedAt
    || !preview.yandexConfirmedAt || !preview.r2ConfirmedAt) return;
  await db.files.delete(keys[0]);
  await db.replicas.bulkDelete(keys);
}

/** Local operational retry state, not a second synchronized business database. */
export async function rememberMediaReplica(entry: DiscussionMediaCacheEntry, fileName: string): Promise<void> {
  if (!mediaUrl(entry) || typeof fileName !== 'string' || fileName.length > 1024) throw new Error('INVALID_MEDIA_REPLICA');
  const db = new DiscussionMediaDatabase(entry.accountId);
  try {
    await db.transaction('rw', db.replicas, async () => {
      const stored = await db.replicas.get(entry.storageKey);
      if (stored) {
        if (stored.mimeType !== entry.mimeType || stored.sizeBytes !== entry.sizeBytes || stored.fileName !== fileName) {
          throw new Error('MEDIA_REPLICA_MISMATCH');
        }
        return;
      }
      await db.replicas.add({ key: entry.storageKey, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes,
        fileName, published: false });
    });
  } finally { db.close(); }
}

export async function confirmMediaReplica(accountId: string, storageKey: string, provider: MediaReplicaProvider): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !directMediaUrl(storageKey)) throw new Error('INVALID_MEDIA_REPLICA');
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const now = new Date().toISOString();
    const patch = provider === 'yandex' ? { yandexConfirmedAt: now } : { r2ConfirmedAt: now };
    const keys = photoReplicaKeys(storageKey);
    if (!keys) await db.replicas.update(storageKey, patch);
    else await db.transaction('rw', db.replicas, db.files, async () => {
      await db.replicas.update(storageKey, patch);
      await cleanCompletedPhoto(db, keys);
    });
  } finally { db.close(); }
}

export async function publishMediaReplica(accountId: string, storageKey: string): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !directMediaUrl(storageKey)) throw new Error('INVALID_MEDIA_REPLICA');
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const keys = photoReplicaKeys(storageKey);
    if (!keys) await db.replicas.update(storageKey, { published: true });
    else await db.transaction('rw', db.replicas, db.files, async () => {
      await Promise.all(keys.map(key => db.replicas.update(key, { published: true })));
      await cleanCompletedPhoto(db, keys);
    });
  }
  finally { db.close(); }
}

export async function reconcilePublishedPhotoReplicas(
  accountId: string, isPublished: (storageKey: string) => Promise<boolean>,
): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId)) return;
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const rows = await db.replicas.filter(row => !row.published && DISCUSSION_MEDIA_KEY_PATTERN.exec(row.key)?.[2] === 'full').toArray();
    for (const row of rows) {
      if (await isPublished(row.key)) await publishMediaReplica(accountId, row.key);
    }
  } finally { db.close(); }
}

/** Delete the bytes of an explicitly discarded draft, not a running or published upload. */
export async function discardUnpublishedDiscussionPhoto(accountId: string, storageKey: string): Promise<void> {
  const keys = photoReplicaKeys(storageKey);
  if (!keys || !/^tg:[1-9]\d*$/.test(accountId)) return;
  const db = new DiscussionMediaDatabase(accountId);
  try {
    await db.transaction('rw', db.replicas, db.files, async () => {
      if ((await db.replicas.bulkGet(keys)).some(row => row?.published)) return;
      await db.files.bulkDelete(keys);
      await db.replicas.bulkDelete(keys);
    });
  } finally { db.close(); }
}

export async function listIncompleteMediaReplicas(accountId: string): Promise<MediaReplicaTask[]> {
  if (!/^tg:[1-9]\d*$/.test(accountId)) return [];
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const rows = await db.replicas.toArray();
    return rows.filter(row => row.published && (!row.r2ConfirmedAt || !row.yandexConfirmedAt))
      .map(row => ({ accountId, storageKey: row.key, mimeType: row.mimeType,
        sizeBytes: row.sizeBytes, fileName: row.fileName,
        yandexConfirmedAt: row.yandexConfirmedAt, r2ConfirmedAt: row.r2ConfirmedAt, published: true }));
  } finally { db.close(); }
}

export async function getMediaReplica(accountId: string, storageKey: string): Promise<MediaReplicaTask | null> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !directMediaUrl(storageKey)) return null;
  const db = new DiscussionMediaDatabase(accountId);
  try {
    const row = await db.replicas.get(storageKey);
    return row ? { ...row, accountId, storageKey: row.key } : null;
  } finally { db.close(); }
}

const downloads = new Map<string, Promise<Blob | null>>();

/** Cache a complete response. The first video player can stream independently. */
export function downloadDiscussionMedia(entry: DiscussionMediaCacheEntry): Promise<Blob | null> {
  const url = mediaUrl(entry);
  if (!url) return Promise.resolve(null);
  const key = JSON.stringify([entry.accountId, entry.storageKey, entry.mimeType, entry.sizeBytes,
    entry.realmId, entry.messageId, entry.attachmentId]);
  const active = downloads.get(key);
  if (active) return active;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  const fetchComplete = async (source: string, signal: AbortSignal): Promise<Blob | null> => {
    try {
      const response = await fetch(source, {
        signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      const length = response.headers.get('content-length');
      if (response.status !== 200 || (length !== null && Number(length) !== entry.sizeBytes)) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      const blob = await response.blob();
      return matches(entry, blob) ? blob : null;
    } catch {
      return null;
    }
  };
  const task = (async () => {
    try {
      // An unreachable Yandex connection must not monopolize the full media timeout.
      const primary = new AbortController();
      const cancel = () => primary.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      const primaryTimeout = setTimeout(() => primary.abort(), 8_000);
      let blob: Blob | null = null;
      try { blob = await fetchComplete(url, primary.signal); }
      finally {
        clearTimeout(primaryTimeout);
        controller.signal.removeEventListener('abort', cancel);
      }
      if (!blob && !controller.signal.aborted && entry.realmId && entry.messageId && entry.attachmentId) {
        try {
          const fallbackUrl = await signedDiscussionR2ReadUrl(entry, controller.signal);
          blob = await fetchComplete(fallbackUrl, controller.signal);
        } catch { /* R2 may be unreachable or this user may no longer have realm access. */ }
      }
      if (!blob) return null;
      if (DISCUSSION_MEDIA_KEY_PATTERN.exec(entry.storageKey)?.[2] !== 'full') await storeDiscussionMedia(entry, blob);
      return blob;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => downloads.delete(key));
  downloads.set(key, task);
  return task;
}
