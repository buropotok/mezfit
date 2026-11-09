export const MEDIA_BUCKET = 'mezfit-comm-poc-20261106';
const endpoint = 'https://storage.yandexcloud.net';
const MiB = 1024 * 1024;
const limits = new Map<string, number>([
  ['image/jpeg', 20], ['image/png', 20], ['image/webp', 20], ['image/gif', 20], ['image/heic', 20],
  ['video/mp4', 250], ['video/webm', 250], ['video/quicktime', 250],
  ['audio/ogg', 25], ['audio/webm', 25], ['audio/mp4', 25], ['audio/mpeg', 25], ['audio/wav', 25],
]);
export const MEDIA_FILE_ACCEPT = [...limits.keys()].join(',');

type UploadErrorCode = 'INVALID_TYPE' | 'INVALID_SIZE' | 'CANCELLED' | 'TIMEOUT' | 'NETWORK' | 'HTTP';
export class MediaUploadError extends Error {
  constructor(readonly code: UploadErrorCode, readonly status?: number) {
    super(code);
    this.name = 'MediaUploadError';
  }
}

export interface UploadedMedia {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
}

export async function uploadDirectMedia(
  file: File,
  { signal, timeoutMs = 300_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<UploadedMedia> {
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');
  const contentType = file.type.toLowerCase().split(';')[0].trim();
  const limit = limits.get(contentType);
  if (!limit) throw new MediaUploadError('INVALID_TYPE');
  if (!file.size || file.size > limit * MiB) throw new MediaUploadError('INVALID_SIZE');

  const key = 'mvp-media/' + Array.from(crypto.getRandomValues(new Uint8Array(32)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const url = `${endpoint}/${MEDIA_BUCKET}/${key}`;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'If-None-Match': '*' },
      body: file,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    // Object Storage has no useful response body for a successful PUT.
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new MediaUploadError('HTTP', response.status);
    if (controller.signal.aborted) throw new MediaUploadError(timedOut ? 'TIMEOUT' : 'CANCELLED');
    return { key, url, contentType, sizeBytes: file.size, fileName: file.name };
  } catch (error) {
    if (signal?.aborted) throw new MediaUploadError('CANCELLED');
    if (timedOut) throw new MediaUploadError('TIMEOUT');
    if (error instanceof MediaUploadError) throw error;
    throw new MediaUploadError('NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
