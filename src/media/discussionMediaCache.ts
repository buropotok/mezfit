import Dexie, { type Table } from 'dexie';
import { directMediaSizeLimit, directMediaUrl } from './directMediaUpload';

export interface DiscussionMediaCacheEntry {
  accountId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

class DiscussionMediaDatabase extends Dexie {
  files!: Table<{ key: string; blob: Blob }, string>;

  constructor(accountId: string) {
    super(`mezfit-discussion-media:${accountId}`);
    this.version(1).stores({ files: '&key' });
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

export async function storeDiscussionMedia(entry: DiscussionMediaCacheEntry, blob: Blob): Promise<void> {
  if (!mediaUrl(entry) || !matches(entry, blob)) return;
  const db = new DiscussionMediaDatabase(entry.accountId);
  try {
    await db.files.put({ key: entry.storageKey, blob });
  } catch {
    // Unavailable storage or an exhausted quota must not block sending or playback.
  } finally {
    db.close();
  }
}

const downloads = new Map<string, Promise<Blob | null>>();

/** Cache a complete response. The first video player can stream independently. */
export function downloadDiscussionMedia(entry: DiscussionMediaCacheEntry): Promise<Blob | null> {
  const url = mediaUrl(entry);
  if (!url) return Promise.resolve(null);
  const key = JSON.stringify([entry.accountId, entry.storageKey, entry.mimeType, entry.sizeBytes]);
  const active = downloads.get(key);
  if (active) return active;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  const task = (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      const length = response.headers.get('content-length');
      if (response.status !== 200 || (length !== null && Number(length) !== entry.sizeBytes)) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      const blob = await response.blob();
      if (!matches(entry, blob)) return null;
      await storeDiscussionMedia(entry, blob);
      return blob;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => downloads.delete(key));
  downloads.set(key, task);
  return task;
}
