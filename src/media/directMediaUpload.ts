export const MEDIA_BUCKET = 'mezfit-comm-poc-20261106';
const endpoint = 'https://storage.yandexcloud.net';
const MiB = 1024 * 1024;
const limits = new Map<string, number>([
  ['image/jpeg', 20], ['image/png', 20], ['image/webp', 20], ['image/gif', 20], ['image/heic', 20],
  ['video/mp4', 250], ['video/webm', 250], ['video/quicktime', 250],
  ['audio/ogg', 25], ['audio/webm', 25], ['audio/mp4', 25], ['audio/mpeg', 25], ['audio/wav', 25],
]);
export const MEDIA_FILE_ACCEPT = [...limits.keys()].join(',');

export function directMediaUrl(key: string): string | null {
  return /^mvp-media\/[a-f0-9]{64}$/.test(key) ? `${endpoint}/${MEDIA_BUCKET}/${key}` : null;
}

export function createDirectMediaKey(): string {
  return 'mvp-media/' + Array.from(crypto.getRandomValues(new Uint8Array(32)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

type UploadErrorCode = 'INVALID_KEY' | 'INVALID_TYPE' | 'INVALID_SIZE' | 'CANCELLED' | 'TIMEOUT' | 'NETWORK' | 'HTTP';
export class MediaUploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly status?: number,
    readonly s3Code?: string,
    readonly s3Message?: string,
  ) {
    super(code);
    this.name = 'MediaUploadError';
  }
}

// S3 error bodies are untrusted XML. Return only small, safe diagnostic fields.
async function readS3Error(response: Response): Promise<{ s3Code?: string; s3Message?: string }> {
  try {
    const body = await response.text();
    if (body.length > 8192 || body.includes('<!DOCTYPE')) return {};
    const document = new DOMParser().parseFromString(body, 'application/xml');
    const root = document.documentElement;
    if (root.localName !== 'Error') return {};
    const field = (name: string): string | undefined => {
      const element = Array.from(root.children).find(child =>
        child.localName === name && child.namespaceURI === root.namespaceURI);
      return element?.childElementCount ? undefined : element?.textContent?.trim();
    };
    const code = field('Code');
    const message = field('Message');
    const safeCode = code && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(code) ? code : undefined;
    return {
      s3Code: safeCode,
      s3Message: safeCode && message && message.length <= 160
        && !/[\u0000-\u001f<>/?&=\\@]/.test(message) && !/[A-Za-z0-9_-]{32,}/.test(message)
        ? message : undefined,
    };
  } catch {
    // Unreadable, non-XML or malformed bodies must not hide the HTTP status.
    return {};
  }
}

export interface UploadedMedia {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
}

export function directMediaSizeLimit(contentType: string): number {
  return (limits.get(contentType) ?? 0) * MiB;
}

export function validateDirectMedia(file: File): string {
  const contentType = file.type.toLowerCase().split(';')[0].trim();
  const limit = directMediaSizeLimit(contentType);
  if (!limit) throw new MediaUploadError('INVALID_TYPE');
  if (!file.size || file.size > limit) throw new MediaUploadError('INVALID_SIZE');
  return contentType;
}

export async function uploadDirectMedia(
  file: File,
  { signal, timeoutMs = 300_000, retryKey, diagnosticOmitIfNoneMatch = false }: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retryKey?: string;
    diagnosticOmitIfNoneMatch?: boolean;
  } = {},
): Promise<UploadedMedia> {
  if (signal?.aborted) throw new MediaUploadError('CANCELLED');
  // Diagnostic-only unconditional PUT must never target a caller-supplied existing object key.
  if (diagnosticOmitIfNoneMatch && retryKey !== undefined) throw new MediaUploadError('INVALID_KEY');
  const contentType = validateDirectMedia(file);
  const key = retryKey ?? createDirectMediaKey();
  const url = directMediaUrl(key);
  if (!url) throw new MediaUploadError('INVALID_KEY');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const request = {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    } satisfies RequestInit;
    const response = await fetch(url, {
      ...request,
      method: 'PUT',
      headers: diagnosticOmitIfNoneMatch
        ? { 'Content-Type': contentType }
        : { 'Content-Type': contentType, 'If-None-Match': '*' },
      body: file,
    });
    // Keep failed PUT bodies readable for S3 error diagnostics.
    if (response.ok || (retryKey && response.status === 412)) {
      void response.body?.cancel().catch(() => undefined);
    }
    if (retryKey && response.status === 412) {
      // A previous PUT may have committed before its response was lost.
      const stored = await fetch(url, { ...request, method: 'HEAD', cache: 'no-store' });
      if (!stored.ok || stored.headers.get('content-type') !== contentType
        || stored.headers.get('content-length') !== String(file.size)) throw new MediaUploadError('HTTP', 412);
    } else if (!response.ok) {
      const { s3Code, s3Message } = await readS3Error(response);
      throw new MediaUploadError('HTTP', response.status, s3Code, s3Message);
    }
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
