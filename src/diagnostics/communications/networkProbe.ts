/** Opt-in COMM-02 transport experiment. Never imports/open the business database. */
export const HARNESS_VERSION = 'comm02-20261106-1';
export type ProbeCode = 'OK' | 'HTTP_ERROR' | 'NETWORK_OR_CORS' | 'CANCELLED' | 'TIMEOUT' | 'INVALID_RESPONSE';
export interface ProbeResult { step: string; code: ProbeCode; status: number | null; elapsedMs: number }
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
