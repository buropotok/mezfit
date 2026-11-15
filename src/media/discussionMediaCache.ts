import Dexie, { type Table } from 'dexie';
import { directMediaSizeLimit, directMediaUrl } from './directMediaUpload';
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

function mediaUrl(entry: DiscussionMediaCacheEntry) {
  if (!/^tg:[1-9]\d*$/.test(entry.accountId) || !/^(image|video|audio)\//.test(entry.mimeType)
    || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0
    || entry.sizeBytes > directMediaSizeLimit(entry.mimeType)) return null;
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
    await db.replicas.update(storageKey,
      provider === 'yandex' ? { yandexConfirmedAt: new Date().toISOString() } : { r2ConfirmedAt: new Date().toISOString() });
  } finally { db.close(); }
}

export async function publishMediaReplica(accountId: string, storageKey: string): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !directMediaUrl(storageKey)) throw new Error('INVALID_MEDIA_REPLICA');
  const db = new DiscussionMediaDatabase(accountId);
  try { await db.replicas.update(storageKey, { published: true }); }
  finally { db.close(); }
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
      await storeDiscussionMedia(entry, blob);
      return blob;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => downloads.delete(key));
  downloads.set(key, task);
  return task;
}
