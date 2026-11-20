import { uploadDirectMedia, directMediaUrl, validateDirectMedia, MediaUploadError, type UploadedMedia } from './directMediaUpload';
import { isDiscussionMediaBackupEnabled } from './discussionMediaBackupPreference';
import { uploadCloudflareMedia } from './cloudflareMediaUpload';
import type { DiscussionPhotoPreview } from '../../shared/discussion-attachment';
import {
  rememberMediaReplica, confirmMediaReplica, publishMediaReplica, listIncompleteMediaReplicas,
  readDiscussionMedia, getMediaReplica, reconcilePublishedPhotoReplicas, type DiscussionMediaCacheEntry, type MediaReplicaProvider,
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
  { accountId, retryKey, signal, preview }: {
    accountId: string; retryKey: string; signal?: AbortSignal; preview?: DiscussionPhotoPreview;
  },
): Promise<UploadedMedia> {
  const entry = { accountId, storageKey: retryKey, mimeType: validateDirectMedia(file), sizeBytes: file.size };
  const variants = [{ entry, file }];
  let yandexOnly: true | undefined = isDiscussionMediaBackupEnabled() ? undefined : true;
  if (preview) {
    const previewEntry = { accountId, ...preview };
    const blob = await readDiscussionMedia(previewEntry);
    if (!blob) throw new Error('DISCUSSION_PHOTO_PREVIEW_MISSING');
    const previewFile = new File([blob], preview.mimeType === 'image/webp' ? 'preview.webp' : 'preview.jpg',
      { type: preview.mimeType });
    variants.push({ entry: previewEntry, file: previewFile });
    const existing = await getMediaReplica(accountId, retryKey);
    if (existing?.yandexOnly) yandexOnly = true;
    // Preserve the original recovery policy when recreating a missing variant task.
    const replicaYandexOnly = existing ? existing.yandexOnly : yandexOnly;
    await rememberMediaReplica(entry, file.name, replicaYandexOnly);
    await rememberMediaReplica(previewEntry, previewFile.name, replicaYandexOnly);
  } else if (!yandexOnly) {
    await rememberMediaReplica(entry, file.name).catch(() => undefined);
  }
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');
  // External cancellation applies only until the first provider confirms success.
  // Once publication is allowed, the remaining transfer is owned by the replica service.
  const transfer = new AbortController();
  let delivered = false;
  const cancel = () => { if (!delivered) transfer.abort(); };
  signal?.addEventListener('abort', cancel, { once: true });

  const uploadTo = async (provider: MediaReplicaProvider): Promise<UploadedMedia> => {
    const results = await Promise.allSettled(variants.map(async variant => {
      const { storageKey, mimeType, sizeBytes } = variant.entry;
      const identity = `${accountId}:${storageKey}:${provider}`;
      inFlightReplicas.add(identity);
      try {
        const replica = preview ? await getMediaReplica(accountId, storageKey) : null;
        const confirmed = provider === 'yandex' ? replica?.yandexConfirmedAt : replica?.r2ConfirmedAt;
        const url = confirmed && directMediaUrl(storageKey);
        if (url) return { key: storageKey, url, contentType: mimeType, sizeBytes, fileName: variant.file.name };
        const upload = provider === 'yandex' ? uploadDirectMedia : uploadCloudflareMedia;
        const uploaded = await upload(variant.file, { retryKey: storageKey, signal: transfer.signal });
        const confirmation = confirmMediaReplica(accountId, storageKey, provider);
        if (preview) await confirmation;
        else await confirmation.catch(() => undefined);
        return uploaded;
      } finally {
        inFlightReplicas.delete(identity);
      }
    }));
    // Every variant must succeed at the same provider. Wait for sibling transfers
    // to settle even if one fails so hedging and subsequent retries can own them safely.
    const [full, ...remaining] = results;
    if (full.status === 'rejected') throw full.reason;
    for (const result of remaining) if (result.status === 'rejected') throw result.reason;
    return preview ? { ...full.value, preview } : full.value;
  };
  if (yandexOnly) {
    try {
      return await uploadTo('yandex');
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  let yandexSettled: () => void = () => undefined;
  const yandexDone = new Promise<void>(resolve => { yandexSettled = resolve; });
  const yandex = uploadTo('yandex').finally(yandexSettled);

  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  const hedge = new Promise<void>(resolve => { hedgeTimer = setTimeout(resolve, 8_000); });
  const r2 = (async () => {
    await Promise.race([yandexDone, hedge]);
    if (hedgeTimer) clearTimeout(hedgeTimer);
    if (transfer.signal.aborted) throw new MediaUploadError('CANCELLED');
    if (!isDiscussionMediaBackupEnabled()) return yandex;
    return uploadTo('r2');
  })();

  try {
    const first = await Promise.any([yandex, r2]);
    delivered = true;
    signal?.removeEventListener('abort', cancel);
    return first;
  } catch {
    if (transfer.signal.aborted) throw new MediaUploadError('CANCELLED');
    // Preserve the primary Yandex failure when R2 cannot authenticate or sign:
    // the fallback must not replace an actionable Yandex error with a secondary failure.
    const reasons = await Promise.allSettled([yandex, r2]);
    const yandexError = reasons[0].status === 'rejected' ? reasons[0].reason : undefined;
    const r2Error = reasons[1].status === 'rejected' ? reasons[1].reason : undefined;
    if (r2Error instanceof MediaUploadError
      && (r2Error.code === 'SIGNER_UNAVAILABLE' || r2Error.code === 'SIGNER_AUTH')
      && yandexError) throw yandexError;
    throw r2Error ?? yandexError ?? new MediaUploadError('NETWORK');
  } finally {
    if (hedgeTimer) clearTimeout(hedgeTimer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Mark only after the domain repository has published the actual attachment. */
export async function acceptMediaReplica(accountId: string, storageKey: string): Promise<void> {
  await publishMediaReplica(accountId, storageKey);
}

/** Re-check volatile browser state on every recovery iteration. */
function canResumeMediaReplicas(): boolean {
  return navigator.onLine !== false && document.visibilityState !== 'hidden';
}

/** Called from the authenticated application lifecycle; never waits on React components. */
export async function resumeMediaReplicaUploads(
  accountId: string, isPhotoPublished?: (storageKey: string) => Promise<boolean>,
): Promise<void> {
  if (inFlightRecovery.has(accountId) || !canResumeMediaReplicas()) return;
  inFlightRecovery.add(accountId);
  try {
    // Recover the crash window after committing the message but before marking
    // the separate local media queue as published.
    if (isPhotoPublished) await reconcilePublishedPhotoReplicas(accountId, isPhotoPublished).catch(() => undefined);
    const pending = await listIncompleteMediaReplicas(accountId);
    for (const task of pending) {
      if (!canResumeMediaReplicas()) break;
      if (!directMediaUrl(task.storageKey)) continue;
      const blob = await readDiscussionMedia(task);
      if (!blob) continue; // Evicted cache: do not claim replication is complete.
      const file = new File([blob], task.fileName, { type: task.mimeType });
      // A stalled primary transfer must not delay recovery of the independent R2 copy.
      const providers: MediaReplicaProvider[] = [];
      if (!task.yandexConfirmedAt) providers.push('yandex');
      if (!task.yandexOnly && !task.r2ConfirmedAt && isDiscussionMediaBackupEnabled()) providers.push('r2');
      await Promise.all(providers.map(provider => attemptReplica(file, task, provider)));
    }
  } catch {
    // No background retry failure may block the Mini App shell.
  } finally {
    inFlightRecovery.delete(accountId);
  }
}
