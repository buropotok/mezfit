import Dexie, { type Table } from 'dexie';
import { ApiError } from '../api';
import { directMediaUrl } from './directMediaUpload';
import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaObjectSizeLimit } from '../../shared/discussion-media-limits';
import type { DiscussionPhotoPreview } from '../../shared/discussion-attachment';
import { isDiscussionMediaBackupEnabled } from './discussionMediaBackupPreference';
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
  /** Historical field name for Yandex-first sends without a required backup copy. */
  yandexOnly?: true;
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
    await db.transaction('rw', db.files, db.replicas, async () => {
      const protectedKeys = new Set(await db.replicas.toCollection().primaryKeys());
      if (!protectedKeys.size) await db.files.clear();
      else {
        const keys = await db.files.toCollection().primaryKeys();
        await db.files.bulkDelete(keys.filter(key => !protectedKeys.has(key)));
      }
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
    const isVideo = full.mimeType.startsWith('video/') && file instanceof File;
    if (!isVideo) {
      await db.transaction('rw', db.files, () =>
        db.files.bulkPut([{ key: full.storageKey, blob: file }, { key: preview.storageKey, blob: thumbnail }]));
    } else {
      const yandexOnly = isDiscussionMediaBackupEnabled() ? undefined : true;
      await db.transaction('rw', db.files, db.replicas, async () => {
        await ensureMediaReplica(db, full, file.name, yandexOnly);
        await ensureMediaReplica(db, previewEntry, preview.mimeType === 'image/webp' ? 'preview.webp' : 'preview.jpg', yandexOnly);
        await db.files.bulkPut([{ key: full.storageKey, blob: file }, { key: preview.storageKey, blob: thumbnail }]);
      });
    }
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
  if (!full?.published || !preview?.published) return;
  const completeInYandex = full.yandexConfirmedAt && preview.yandexConfirmedAt;
  const completeInR2 = full.r2ConfirmedAt && preview.r2ConfirmedAt;
  const fallbackOnly = full.yandexOnly && preview.yandexOnly;
  if (fallbackOnly ? !(completeInYandex || completeInR2) : !(completeInYandex && completeInR2)) return;
  await db.files.delete(keys[0]);
  await db.replicas.bulkDelete(keys);
}

async function ensureMediaReplica(
  db: DiscussionMediaDatabase, entry: DiscussionMediaCacheEntry, fileName: string, yandexOnly?: true,
): Promise<void> {
  const stored = await db.replicas.get(entry.storageKey);
  if (stored) {
    if (stored.mimeType !== entry.mimeType || stored.sizeBytes !== entry.sizeBytes || stored.fileName !== fileName) {
      throw new Error('MEDIA_REPLICA_MISMATCH');
    }
    return;
  }
  await db.replicas.add({ key: entry.storageKey, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes,
    fileName, yandexOnly, published: false });
}

/** Local operational retry state, not a second synchronized business database. */
export async function rememberMediaReplica(
  entry: DiscussionMediaCacheEntry, fileName: string, yandexOnly?: true,
): Promise<void> {
  if (!mediaUrl(entry) || typeof fileName !== 'string' || fileName.length > 1024) throw new Error('INVALID_MEDIA_REPLICA');
  const db = new DiscussionMediaDatabase(entry.accountId);
  try {
    await db.transaction('rw', db.replicas, () => ensureMediaReplica(db, entry, fileName, yandexOnly));
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
    return rows.filter(row => row.published && !row.yandexOnly && (!row.yandexConfirmedAt || !row.r2ConfirmedAt))
      .map(row => ({ accountId, storageKey: row.key, mimeType: row.mimeType,
        sizeBytes: row.sizeBytes, fileName: row.fileName,
        yandexConfirmedAt: row.yandexConfirmedAt, r2ConfirmedAt: row.r2ConfirmedAt, yandexOnly: row.yandexOnly, published: true }));
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

interface DownloadResult {
  blob: Blob | null;
  r2Failure?: string;
}

const downloads = new Map<string, { result: Promise<DownloadResult>; blob: Promise<Blob | null> }>();
const PRIMARY_RESPONSE_TIMEOUT_MS = 8_000;
const FULL_PHOTO_IDLE_TIMEOUT_MS = 15_000;
const R2_PHOTO_PART_BYTES = 1024 * 1024;

async function readFullPhoto(response: Response, sizeBytes: number, onProgress: () => void): Promise<Blob | null> {
  if (!response.body) return response.blob();

  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      received += value.byteLength;
      if (received > sizeBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      onProgress();
      parts.push(new Uint8Array(value).buffer);
    }
    return new Blob(parts, { type: response.headers.get('content-type') ?? '' });
  } finally {
    reader.releaseLock();
  }
}

async function readR2PhotoInParts(
  source: string, entry: DiscussionMediaCacheEntry, request: RequestInit, resetIdleTimeout: () => void,
): Promise<Blob | null> {
  const parts: Blob[] = [];
  for (let start = 0; start < entry.sizeBytes; start += R2_PHOTO_PART_BYTES) {
    if (request.signal?.aborted) return null;
    const end = Math.min(start + R2_PHOTO_PART_BYTES, entry.sizeBytes) - 1;
    const size = end - start + 1;
    resetIdleTimeout();
    const response = await fetch(source, { ...request, headers: { Range: `bytes=${start}-${end}` } });
    // Some bucket CORS policies don't expose Content-Range to the browser.
    const range = response.headers.get('content-range');
    const length = response.headers.get('content-length');
    if (response.status !== 206 || (range !== null && range !== `bytes ${start}-${end}/${entry.sizeBytes}`)
      || (length !== null && Number(length) !== size)) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    resetIdleTimeout();
    const part = await readFullPhoto(response, size, resetIdleTimeout);
    if (!part || !matches({ ...entry, sizeBytes: size }, part)) return null;
    parts.push(part);
  }
  return new Blob(parts, { type: entry.mimeType });
}

/** Cache a complete response. The first video player can stream independently. */
export function downloadDiscussionMedia(entry: DiscussionMediaCacheEntry): Promise<Blob | null> {
  return startDiscussionMediaDownload(entry).blob;
}

export function downloadDiscussionMediaWithStatus(entry: DiscussionMediaCacheEntry): Promise<DownloadResult> {
  return startDiscussionMediaDownload(entry).result;
}

function startDiscussionMediaDownload(entry: DiscussionMediaCacheEntry) {
  const url = mediaUrl(entry);
  if (!url) return { result: Promise.resolve({ blob: null }), blob: Promise.resolve(null) };
  const key = JSON.stringify([entry.accountId, entry.storageKey, entry.mimeType, entry.sizeBytes,
    entry.realmId, entry.messageId, entry.attachmentId]);
  const active = downloads.get(key);
  if (active) return active;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  const full = DISCUSSION_MEDIA_KEY_PATTERN.exec(entry.storageKey)?.[2] === 'full';
  const fullPhoto = full && entry.mimeType.startsWith('image/');
  let r2Failure: string | undefined;
  const fetchComplete = async (
    resolveSource: (signal: AbortSignal) => string | Promise<string>, primary: boolean,
  ): Promise<Blob | null> => {
    if (controller.signal.aborted) return null;
    const attempt = new AbortController();
    const { signal } = attempt;
    const cancel = () => attempt.abort();
    controller.signal.addEventListener('abort', cancel, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = (delay: number) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(cancel, delay);
    };
    const receivedData = () => startTimer(FULL_PHOTO_IDLE_TIMEOUT_MS);
    if (primary) startTimer(PRIMARY_RESPONSE_TIMEOUT_MS);
    else if (fullPhoto) receivedData();

    let stage: 'SIGN' | 'GET' | 'BODY' | 'RANGE' = 'SIGN';
    try {
      const source = await resolveSource(signal);
      stage = 'GET';
      if (fullPhoto && !primary) receivedData();
      const request = {
        signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      } satisfies RequestInit;
      const response = await fetch(source, request);
      const length = response.headers.get('content-length');
      if (response.status !== 200 || (length !== null && Number(length) !== entry.sizeBytes)) {
        if (!primary) r2Failure = response.status !== 200 ? `R2-GET-${response.status}` : 'R2-SIZE';
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      stage = 'BODY';
      if (fullPhoto) receivedData();
      let blob: Blob | null;
      try {
        blob = fullPhoto ? await readFullPhoto(response, entry.sizeBytes, receivedData) : await response.blob();
      } catch (error) {
        if (primary || !fullPhoto || signal.aborted || entry.sizeBytes <= R2_PHOTO_PART_BYTES) throw error;
        stage = 'RANGE';
        blob = await readR2PhotoInParts(source, entry, request, receivedData);
      }
      if (!signal.aborted && blob && matches(entry, blob)) return blob;
      if (!primary) r2Failure = signal.aborted ? `R2-${stage}-TIMEOUT`
        : stage === 'RANGE' ? 'R2-RANGE-INVALID'
        : !blob || blob.size !== entry.sizeBytes ? 'R2-SIZE' : 'R2-MIME';
      return null;
    } catch (error) {
      if (!primary) {
        const detail = signal.aborted ? 'TIMEOUT'
          : error instanceof ApiError && error.code === 'DISCUSSION_R2_HTTP' ? error.status : 'FAILED';
        r2Failure = `R2-${stage}-${detail}`;
      }
      return null;
    } finally {
      clearTimeout(idleTimer);
      controller.signal.removeEventListener('abort', cancel);
    }
  };
  const result = (async () => {
    try {
      let blob = await fetchComplete(() => url, true);
      if (!blob && entry.realmId && entry.messageId && entry.attachmentId) {
        blob = await fetchComplete(signal => signedDiscussionR2ReadUrl(entry, signal), false);
      }
      if (blob && !full) await storeDiscussionMedia(entry, blob);
      return { blob, r2Failure };
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => downloads.delete(key));
  let blobTask: Promise<Blob | null> | undefined;
  const task = {
    result,
    get blob() {
      return blobTask ??= result.then(download => download.blob);
    },
  };
  downloads.set(key, task);
  return task;
}
