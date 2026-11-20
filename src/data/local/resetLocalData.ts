const RESET_REQUEST_KEY = 'mezfit.local-data-reset.v1';

export interface LocalDataResetSelection {
  media: boolean;
  workouts: boolean;
}

interface PendingReset extends LocalDataResetSelection {
  telegramUserId: string;
}

function validUserId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[1-9]\d*$/.test(value);
}

export function requestLocalDataReset(
  telegramUserId: string,
  selection: LocalDataResetSelection,
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
): void {
  if (!validUserId(telegramUserId) || (!selection.media && !selection.workouts)) {
    throw new Error('INVALID_LOCAL_DATA_RESET');
  }
  storage.setItem(RESET_REQUEST_KEY, JSON.stringify({ telegramUserId, ...selection } satisfies PendingReset));
}

/** Run before mounting React/Dexie. Reloading closes all live DB connections first. */
export async function completePendingLocalDataReset(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.sessionStorage,
  factory: IDBFactory = indexedDB,
): Promise<boolean> {
  const raw = storage.getItem(RESET_REQUEST_KEY);
  if (!raw) return false;

  let pending: PendingReset;
  try {
    pending = JSON.parse(raw) as PendingReset;
  } catch {
    storage.removeItem(RESET_REQUEST_KEY);
    return false;
  }
  if (!pending || !validUserId(pending.telegramUserId)
    || typeof pending.media !== 'boolean' || typeof pending.workouts !== 'boolean'
    || (!pending.media && !pending.workouts)) {
    storage.removeItem(RESET_REQUEST_KEY);
    return false;
  }

  const remove = (name: string) => new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_DELETE_FAILED'));
    request.onblocked = () => reject(new Error('INDEXEDDB_DELETE_BLOCKED'));
  });

  if (pending.media) {
    // Discussion replicas may own original bytes not yet copied to both media stores.
    // Clear disposable cache entries only; never discard recovery tasks or their files.
    const { clearDiscussionMediaCache } = await import('../../media/discussionMediaCache');
    await clearDiscussionMediaCache('tg:' + pending.telegramUserId);
    await remove('mezfit-base2-public-media-v1');
  }
  if (pending.workouts) {
    // Delete physical local stores, never synchronized rows/tombstones.
    // The entire account-scoped Dexie database is rehydrated, including contacts.
    await remove('mezfit-cloud:' + pending.telegramUserId);
    await remove('mezfit-local:' + pending.telegramUserId);
  }

  storage.removeItem(RESET_REQUEST_KEY);
  return true;
}
