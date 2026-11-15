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
 * A single success permits publication. Yandex is attempted first; once it succeeds
 * the R2 copy is independently attempted without blocking the outgoing message.
 * If Yandex fails, R2 becomes the publication path.
 */
export async function uploadMirroredDiscussionMedia(
  file: File,
  { accountId, retryKey, signal }: { accountId: string; retryKey: string; signal?: AbortSignal },
): Promise<UploadedMedia> {
  const entry = { accountId, storageKey: retryKey, mimeType: file.type, sizeBytes: file.size };
  await rememberMediaReplica(entry, file.name).catch(() => undefined);
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');
  let yandexError: unknown;
  try {
    const uploaded = await uploadDirectMedia(file, { retryKey, signal });
    await confirmMediaReplica(accountId, retryKey, 'yandex').catch(() => undefined);
    // The upload owner may close/unmount; replica upload is independent.
    void attemptReplica(file, entry, 'r2');
    return uploaded;
  } catch (error) {
    if (signal?.aborted || (error instanceof MediaUploadError && error.code === 'CANCELLED')) throw error;
    yandexError = error;
  }
  try {
    const uploaded = await uploadCloudflareMedia(file, { retryKey, signal });
    await confirmMediaReplica(accountId, retryKey, 'r2').catch(() => undefined);
    return uploaded;
  } catch (error) {
    if (signal?.aborted || (error instanceof MediaUploadError && error.code === 'CANCELLED')) throw error;
    // The old Yandex error is more useful if the fallback has not been configured yet.
    if (error instanceof MediaUploadError && error.code === 'SIGNER_UNAVAILABLE') throw yandexError;
    throw error;
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
