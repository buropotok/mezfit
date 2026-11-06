/** Opt-in COMM-02 transport experiment. Never imports/open the business database. */
export const HARNESS_VERSION = 'comm02-20261106-1';
export const TEST_BUCKET = 'mezfit-comm-poc-20261106';
export interface StorageTicket { put: string; get: string; head: string }
export type ProbeCode = 'OK' | 'HTTP_ERROR' | 'NETWORK_OR_CORS' | 'CANCELLED' | 'TIMEOUT' | 'INVALID_RESPONSE';
export interface ProbeResult { step: string; code: ProbeCode; status: number | null; elapsedMs: number }
export interface UploadEvent { at: string; kind: 'visibility' | 'progress' | 'complete'; hidden: boolean; loaded: number }

/** Tickets are bearer capabilities: memory only, never include them in reports. */
export function parseStorageTicket(value: unknown): StorageTicket {
  if (!value || typeof value !== 'object') throw new Error('INVALID_TICKET');
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(fields).sort().join(',') !== 'get,head,put') throw new Error('INVALID_TICKET');
  const urls: string[] = [];
  for (const method of ['put', 'get', 'head']) {
    const raw = fields[method];
    if (typeof raw !== 'string' || raw.length > 8192) throw new Error('INVALID_TICKET');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'storage.yandexcloud.net' || url.port
      || url.username || url.password || url.hash
      || !new RegExp(`^/${TEST_BUCKET}/comm02/[A-Za-z0-9_-]+\\.(bin|mp4)$`).test(url.pathname)
      || url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256'
      || !/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '')
      || url.searchParams.get('X-Amz-SignedHeaders') !== 'host'
      || !/^[1-9]\d*$/.test(url.searchParams.get('X-Amz-Expires') ?? '')
      || Number(url.searchParams.get('X-Amz-Expires')) > 900) throw new Error('INVALID_TICKET');
    urls.push(url.href);
  }
  if (urls.some(url => new URL(url).pathname !== new URL(urls[0]).pathname)) throw new Error('INVALID_TICKET');
  return { put: urls[0], get: urls[1], head: urls[2] };
}

/** Error bodies/messages/URLs are deliberately discarded at this boundary. */
export async function probeRequest(
  step: string, url: string, init: RequestInit, signal: AbortSignal,
  verify: (response: Response) => Promise<boolean>, timeoutMs = 20000,
): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const result = (code: ProbeCode, status: number | null = null): ProbeResult => ({ step, code, status, elapsedMs: Date.now() - started });
  try {
    if (signal.aborted) return result('CANCELLED');
    const response = await fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); return result('HTTP_ERROR', response.status); }
    let valid = false;
    try { valid = await verify(response); } catch { /* Malformed successful payload, never print it. */ }
    await response.body?.cancel().catch(() => undefined);
    return result(signal.aborted ? 'CANCELLED' : timedOut ? 'TIMEOUT' : valid ? 'OK' : 'INVALID_RESPONSE', response.status);
  } catch {
    return result(signal.aborted ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'NETWORK_OR_CORS');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

/** This proves a fresh network read, never proves a successful cold launch. */
export async function probeHosting(origin: string, signal: AbortSignal): Promise<ProbeResult[]> {
  const nonce = crypto.randomUUID();
  let asset: string | undefined;
  const html = await probeRequest('hosting-html', `${origin}/?comm02=${nonce}`, {}, signal, async response => {
    if (!response.headers.get('content-type')?.includes('text/html')) return false;
    const text = await response.text();
    for (const match of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)) {
      const url = new URL(match[1], origin);
      if (url.origin !== origin || !/^\/assets\/[A-Za-z0-9_.-]+\.js$/.test(url.pathname)) continue;
      url.searchParams.set('comm02', nonce);
      asset = url.href;
      return true;
    }
    return false;
  });
  if (!asset || html.code !== 'OK') return [html];
  return [html, await probeRequest('hosting-js', asset, {}, signal, async response => {
    if (!/javascript/.test(response.headers.get('content-type') ?? '')) return false;
    const reader = response.body?.getReader();
    if (!reader) return false;
    try { const first = await reader.read(); return !first.done && first.value.length > 0; }
    finally { await reader.cancel(); reader.releaseLock(); }
  })];
}

export function uploadProbe(
  ticket: StorageTicket, file: Blob, signal: AbortSignal, onEvent: (event: UploadEvent) => void,
): Promise<ProbeResult> {
  return new Promise(resolve => {
    const started = Date.now();
    const xhr = new XMLHttpRequest();
    let loaded = 0;
    let finished = false;
    const record = (kind: UploadEvent['kind']) => onEvent({ at: new Date().toISOString(), kind, hidden: document.hidden, loaded });
    const visibility = () => record('visibility');
    const cancel = () => xhr.abort();
    const finish = (code: ProbeCode, status: number | null = null) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', cancel);
      document.removeEventListener('visibilitychange', visibility);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      resolve({ step: 'storage-put', code, status, elapsedMs: Date.now() - started });
    };
    if (signal.aborted) { finish('CANCELLED'); return; }
    signal.addEventListener('abort', cancel, { once: true });
    document.addEventListener('visibilitychange', visibility);
    try {
      xhr.open('PUT', ticket.put);
      xhr.timeout = 180000;
      xhr.withCredentials = false;
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => { loaded = event.loaded; record('progress'); };
      xhr.onload = () => { record('complete'); finish(xhr.status >= 200 && xhr.status < 300 ? 'OK' : 'HTTP_ERROR', xhr.status); };
      xhr.onerror = () => finish('NETWORK_OR_CORS');
      xhr.onabort = () => finish('CANCELLED');
      xhr.ontimeout = () => finish('TIMEOUT');
      record('visibility');
      xhr.send(file);
    } catch { finish('NETWORK_OR_CORS'); }
  });
}

export async function probeStorageReads(ticket: StorageTicket, file: Blob, signal: AbortSignal): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  results.push(await probeRequest('storage-head', ticket.head, { method: 'HEAD' }, signal,
    async response => response.status === 200 && Number(response.headers.get('content-length')) === file.size));
  results.push(await probeRequest('storage-get', ticket.get, {}, signal, async response => {
    const reader = response.body?.getReader();
    if (!reader) return false;
    try {
      const first = await reader.read();
      const mime = response.headers.get('content-type')?.split(';')[0];
      return response.status === 200 && (!file.type || mime === file.type) && !first.done && first.value.length > 0;
    }
    finally { await reader.cancel(); reader.releaseLock(); }
  }));
  const count = Math.min(1024, file.size);
  results.push(await probeRequest('storage-range', ticket.get, { headers: { Range: `bytes=0-${count - 1}` } }, signal, async response => {
    if (response.status !== 206 || response.headers.get('content-range') !== `bytes 0-${count - 1}/${file.size}`) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const expected = new Uint8Array(await file.slice(0, count).arrayBuffer());
    return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
  }));
  return results;
}

export function videoDuration(file: Blob, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (duration?: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      video.onloadedmetadata = video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (duration !== undefined && Number.isFinite(duration) && duration > 0 && duration <= 180) resolve(duration);
      else reject(new Error('INVALID_VIDEO'));
    };
    const cancel = () => finish();
    const timer = setTimeout(() => finish(), 15000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { finish(); return; }
    video.preload = 'metadata'; video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(); video.src = url;
  });
}
