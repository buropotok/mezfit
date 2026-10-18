import Dexie, { type Table } from 'dexie';
import { isPersonalExerciseMediaUrl } from './personalExerciseMediaReference';

interface CachedExerciseImage {
  url: string;
  blob: Blob;
}

/** Media files stay local to the signed-in account; they never enter Dexie Cloud replication. */
class PersonalExerciseMediaDatabase extends Dexie {
  images!: Table<CachedExerciseImage, string>;

  constructor(accountId: string) {
    super(`mezfit-personal-exercise-media:${accountId}`);
    this.version(1).stores({ images: '&url' });
  }
}

export async function storePersonalExerciseMedia(
  accountId: string, url: string, blob: Blob,
): Promise<void> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !isPersonalExerciseMediaUrl(url)) return;
  const db = new PersonalExerciseMediaDatabase(accountId);
  try {
    await db.images.put({ url, blob });
  } finally {
    db.close();
  }
}

const downloads = new Map<string, Promise<Blob | null>>();

/** Return IndexedDB bytes first; fetch a versioned R2 asset only on cache miss. */
export async function loadPersonalExerciseMedia(
  accountId: string, url: string, signal?: AbortSignal,
  fetchImage: typeof fetch = fetch,
): Promise<Blob | null> {
  if (!/^tg:[1-9]\d*$/.test(accountId) || !isPersonalExerciseMediaUrl(url)) return null;
  const key = `${accountId}:${url}`;
  const active = downloads.get(key);
  if (active) return active;
  const task = (async () => {
    const db = new PersonalExerciseMediaDatabase(accountId);
    try {
      const stored = await db.images.get(url);
      if (stored?.blob instanceof Blob) return stored.blob;
      if (signal?.aborted) return null;
      const response = await fetchImage(url, { signal, cache: 'force-cache' });
      if (!response.ok || signal?.aborted) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 8 * 1024 * 1024) return null;
      if (!signal?.aborted) await db.images.put({ url, blob });
      return blob;
    } catch {
      // Offline and private-browsing storage failures must not break the exercise card.
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
