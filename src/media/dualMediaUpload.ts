import { uploadDirectMedia, directMediaUrl, MediaUploadError, type UploadedMedia } from './directMediaUpload';
import { uploadCloudflareMedia } from './cloudflareMediaUpload';
import {
  rememberMediaReplica, confirmMediaReplica, publishMediaReplica, listIncompleteMediaReplicas,
  readDiscussionMedia, type DiscussionMediaCacheEntry, type MediaReplicaProvider,
} from './discussionMediaCache';

const inFlightReplicas = new Set<string>();
const inFlightRecovery = new Set<string>();

async function attemptReplica(file: File, entry: DiscussionMediaCacheEntry, provider: MediaReplicaProvider): Promise<boolean> {
  const identity = `${entry.accountId}:${entry.storageKey}:${provider}`;
  if (inFlightReplicas.has(identity)) return false;
  inFlightReplicas.add(identity);
  try {
    if (provider === 'yandex') await uploadDirectMedia(file, { retryKey: entry.storageKey });
    else await uploadCloudflareMedia(file, { retryKey: entry.storageKey });
    await confirmMediaReplica(entry.accountId, entry.storageKey, provider).catch(() => undefined);
    return true;
  } catch {
    // The other confirmed replica remains usable; retain the pending retry.
    return false;
  } finally {
    inFlightReplicas.delete(identity);
  }
}

/**
 * Try Yandex first, but hedge via R2 if it remains unresponsive for eight seconds.
 * The first confirmed provider permits publication; the other keeps uploading
 * independently. The source File has already been saved in IndexedDB by the caller.
 */
export async function uploadMirroredDiscussionMedia(
  file: File,
  { accountId, retryKey, signal }: { accountId: string; retryKey: string; signal?: AbortSignal },
): Promise<UploadedMedia> {
  const entry = { accountId, storageKey: retryKey, mimeType: file.type, sizeBytes: file.size };
  await rememberMediaReplica(entry, file.name).catch(() => undefined);
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');

  const yandexIdentity = `${accountId}:${retryKey}:yandex`;
  const r2Identity = `${accountId}:${retryKey}:r2`;
  inFlightReplicas.add(yandexIdentity);
  let yandexSettled: () => void = () => undefined;
  const yandexDone = new Promise<void>(resolve => { yandexSettled = resolve; });
  const yandex = uploadDirectMedia(file, { retryKey, signal }).then(async uploaded => {
    await confirmMediaReplica(accountId, retryKey, 'yandex').catch(() => undefined);
    return uploaded;
  }).finally(() => {
    inFlightReplicas.delete(yandexIdentity);
    yandexSettled();
  });

  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  const hedge = new Promise<void>(resolve => { hedgeTimer = setTimeout(resolve, 8_000); });
  const r2 = (async () => {
    await Promise.race([yandexDone, hedge]);
    if (hedgeTimer) clearTimeout(hedgeTimer);
    if (signal?.aborted) throw new MediaUploadError('CANCELLED');
    inFlightReplicas.add(r2Identity);
    try {
      const uploaded = await uploadCloudflareMedia(file, { retryKey, signal });
      await confirmMediaReplica(accountId, retryKey, 'r2').catch(() => undefined);
      return uploaded;
    } finally {
      inFlightReplicas.delete(r2Identity);
    }
  })();

  try {
    return await Promise.any([yandex, r2]);
  } catch {
    if (signal?.aborted) throw new MediaUploadError('CANCELLED');
    // Both providers failed. Keep the primary error when the R2 signer is not configured.
    const reasons = await Promise.allSettled([yandex, r2]);
    const yandexError = reasons[0].status === 'rejected' ? reasons[0].reason : undefined;
    const r2Error = reasons[1].status === 'rejected' ? reasons[1].reason : undefined;
    if (r2Error instanceof MediaUploadError && r2Error.code === 'SIGNER_UNAVAILABLE' && yandexError) throw yandexError;
    throw r2Error ?? yandexError ?? new MediaUploadError('NETWORK');
  } finally {
    if (hedgeTimer) clearTimeout(hedgeTimer);
  }
}

/** Mark only after the domain repository has published the actual attachment. */
export async function acceptMediaReplica(accountId: string, storageKey: string): Promise<void> {
  await publishMediaReplica(accountId, storageKey);
}

/** Called from the authenticated application lifecycle; never waits on React components. */
export async function resumeMediaReplicaUploads(accountId: string): Promise<void> {
  if (inFlightRecovery.has(accountId) || navigator.onLine === false || document.visibilityState === 'hidden') return;
  inFlightRecovery.add(accountId);
  try {
    const pending = await listIncompleteMediaReplicas(accountId);
    for (const task of pending) {
      if (navigator.onLine === false || document.visibilityState === 'hidden') break;
      if (!directMediaUrl(task.storageKey)) continue;
      const blob = await readDiscussionMedia(task);
      if (!blob) continue; // Evicted cache: do not claim replication is complete.
      const file = new File([blob], task.fileName, { type: task.mimeType });
      if (!task.yandexConfirmedAt) await attemptReplica(file, task, 'yandex');
      if (!task.r2ConfirmedAt && navigator.onLine !== false && document.visibilityState !== 'hidden') {
        await attemptReplica(file, task, 'r2');
      }
    }
  } catch {
    // No background retry failure may block the Mini App shell.
  } finally {
    inFlightRecovery.delete(accountId);
  }
}
