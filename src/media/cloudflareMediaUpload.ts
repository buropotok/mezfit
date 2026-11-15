import { getTelegramWebApp } from '../telegram';
import { ApiError, requestDiscussionR2Signature, verifyDiscussionR2Upload, type DiscussionR2SignedPut } from '../api';
import { directMediaUrl, MediaUploadError, validateDirectMedia, type UploadedMedia, type MediaUploadStage } from './directMediaUpload';

const signedHeaders = 'content-length;content-type;host;if-none-match';
const R2_UPLOAD_HOST = /^mezfit-discussion-media\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i;

function validSignedPut(value: unknown, key: string): value is { putUrl: string; expiresAt: number; storageKey: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.storageKey !== key || typeof item.putUrl !== 'string'
    || typeof item.expiresAt !== 'number' || !Number.isSafeInteger(item.expiresAt)
    || item.expiresAt <= Date.now()) return false;
  try {
    const url = new URL(item.putUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && R2_UPLOAD_HOST.test(url.host) && url.pathname === '/' + key
      && url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256'
      && url.searchParams.get('X-Amz-SignedHeaders') === signedHeaders
      && /^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '');
  } catch { return false; }
}

export async function uploadCloudflareMedia(
  file: File,
  { retryKey, signal, timeoutMs = 300_000 }: { retryKey: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<UploadedMedia> {
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');
  const contentType = validateDirectMedia(file);
  const publicUrl = directMediaUrl(retryKey);
  if (!publicUrl) throw new MediaUploadError('INVALID_KEY');
  const initData = getTelegramWebApp()?.initData;
  if (!initData) throw new MediaUploadError('SIGNER_AUTH');
  const parameters = { initData, storageKey: retryKey, contentType, sizeBytes: file.size };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  let stage: MediaUploadStage = 'signer';
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const request = { signal: controller.signal, credentials: 'omit', redirect: 'error',
    referrerPolicy: 'no-referrer' } satisfies RequestInit;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      stage = 'signer';
      let payload: DiscussionR2SignedPut;
      try {
        payload = await requestDiscussionR2Signature(parameters, controller.signal);
      } catch (error) {
        if (error instanceof ApiError) {
          throw new MediaUploadError(error.status === 401 ? 'SIGNER_AUTH' : 'SIGNER_UNAVAILABLE',
            error.status, undefined, undefined, stage);
        }
        throw error;
      }
      if (!validSignedPut(payload, retryKey)) throw new MediaUploadError('SIGNER_UNAVAILABLE', undefined, undefined, undefined, stage);
      stage = 'put';
      const response = await fetch(payload.putUrl, { ...request, method: 'PUT', body: file,
        headers: { 'Content-Type': contentType, 'If-None-Match': '*' } });
      if (response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return { key: retryKey, url: publicUrl, fileName: file.name, contentType, sizeBytes: file.size };
      }
      if (response.status === 412) {
        void response.body?.cancel().catch(() => undefined);
        if (!retryKey) throw new MediaUploadError('HTTP', 412, undefined, undefined, stage);
        stage = 'head';
        try {
          await verifyDiscussionR2Upload(parameters, controller.signal);
          return { key: retryKey, url: publicUrl, fileName: file.name, contentType, sizeBytes: file.size };
        } catch (error) {
          if (error instanceof ApiError) {
            throw new MediaUploadError('HTTP', error.status, undefined, undefined, stage);
          }
          throw error;
        }
      }
      const expired = response.status === 403 && Date.now() >= payload.expiresAt;
      void response.body?.cancel().catch(() => undefined);
      if (expired && attempt === 0) continue;
      throw new MediaUploadError('HTTP', response.status, undefined, undefined, stage);
    }
    throw new MediaUploadError('SIGNER_UNAVAILABLE', undefined, undefined, undefined, stage);
  } catch (error) {
    if (signal?.aborted) throw new MediaUploadError('CANCELLED', undefined, undefined, undefined, stage);
    if (timedOut) throw new MediaUploadError('TIMEOUT', undefined, undefined, undefined, stage);
    if (error instanceof MediaUploadError) throw error;
    throw new MediaUploadError('NETWORK', undefined, undefined, undefined, stage);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

