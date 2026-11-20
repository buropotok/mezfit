/** Approximate bytes of IndexedDB payloads, not on-disk usage (indexes and storage overhead vary). */
const encoder = new TextEncoder();
function recordBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return encoder.encode(value).byteLength;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 1;
  if (typeof value !== 'object') return 0;
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Date) return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, item: unknown) => sum + recordBytes(item, seen), 0);
  if (value instanceof Map) {
    let total = 0;
    for (const [key, item] of value) total += recordBytes(key, seen) + recordBytes(item, seen);
    return total;
  }
  if (value instanceof Set) {
    let total = 0;
    for (const item of value) total += recordBytes(item, seen);
    return total;
  }
  return Object.entries(value).reduce((sum, [key, item]) =>
    sum + recordBytes(key, seen) + recordBytes(item, seen), 0);
}

/** Opening a missing database would create it. Abort that upgrade to keep counting read-only. */
async function existingDatabase(name: string, factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let missing = false;
    const request = factory.open(name);
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (missing && request.error?.name === 'AbortError') resolve(null);
      else reject(request.error ?? new Error('INDEXEDDB_SIZE_OPEN_FAILED'));
    };
    request.onblocked = () => reject(new Error('INDEXEDDB_SIZE_BLOCKED'));
  });
}

async function storeKeys(db: IDBDatabase, storeName: string): Promise<Set<IDBValidKey>> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result));
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_SIZE_READ_FAILED'));
    transaction.onabort = () => reject(transaction.error ?? new Error('INDEXEDDB_SIZE_READ_FAILED'));
  });
}

async function storeBytes(db: IDBDatabase, storeName: string, skipKeys?: ReadonlySet<IDBValidKey>): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).openCursor();
    let bytes = 0;
    let readError: Error | null = null;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try {
        if (!skipKeys?.has(cursor.primaryKey)) {
          bytes += recordBytes(cursor.primaryKey) + recordBytes(cursor.value);
        }
        cursor.continue();
      } catch (reason) {
        readError = reason instanceof Error ? reason : new Error('INDEXEDDB_SIZE_READ_FAILED');
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(bytes);
    transaction.onabort = () => reject(readError ?? transaction.error ?? new Error('INDEXEDDB_SIZE_READ_FAILED'));
    transaction.onerror = () => reject(transaction.error ?? new Error('INDEXEDDB_SIZE_READ_FAILED'));
  });
}

async function databaseBytes(
  name: string, factory: IDBFactory, stores?: readonly string[],
  skipKeys?: ReadonlySet<IDBValidKey>,
): Promise<number> {
  const db = await existingDatabase(name, factory);
  if (!db) return 0;
  try {
    const names = stores ?? Array.from(db.objectStoreNames);
    let total = 0;
    for (const store of names) {
      if (db.objectStoreNames.contains(store)) total += await storeBytes(db, store, skipKeys);
    }
    return total;
  } finally {
    db.close();
  }
}

function verifyAccount(telegramUserId: string): void {
  if (!/^[1-9]\d*$/.test(telegramUserId)) throw new Error('INVALID_LOCAL_DATABASE_USER_ID');
}

/** Size of disposable caches only. Original media retained for unfinished replicas is excluded. */
export async function estimateMediaCacheBytes(
  telegramUserId: string, factory: IDBFactory = indexedDB,
): Promise<number> {
  verifyAccount(telegramUserId);
  const mediaDbName = 'mezfit-discussion-media:tg:' + telegramUserId;
  const mediaDb = await existingDatabase(mediaDbName, factory);
  let discussionBytes = 0;
  if (mediaDb) {
    try {
      if (mediaDb.objectStoreNames.contains('files')) {
        const protectedKeys = mediaDb.objectStoreNames.contains('replicas')
          ? await storeKeys(mediaDb, 'replicas') : new Set<IDBValidKey>();
        discussionBytes = await storeBytes(mediaDb, 'files', protectedKeys);
      }
    } finally {
      mediaDb.close();
    }
  }
  const exerciseMediaBytes = await databaseBytes('mezfit-base2-public-media-v1', factory, ['images']);
  return discussionBytes + exerciseMediaBytes;
}

/** The two local account databases are deleted together on reset, never via synced row deletes. */
export async function estimateLocalDataBytes(
  telegramUserId: string, factory: IDBFactory = indexedDB,
): Promise<number> {
  verifyAccount(telegramUserId);
  const cloud = await databaseBytes('mezfit-cloud:' + telegramUserId, factory);
  const legacy = await databaseBytes('mezfit-local:' + telegramUserId, factory);
  return cloud + legacy;
}
