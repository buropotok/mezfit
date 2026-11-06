import { createHash, timingSafeEqual } from 'node:crypto';

const DB_ORIGIN = 'https://zjv60oxag.dexie.cloud';
const digest = value => createHash('sha256').update(value).digest();

/**
 * Deploy only after owner approval to the actual prospective Yandex gateway runtime.
 * Network experiment only: no signing, resources, membership, schema or business writes.
 * Read token must be an ordinary, scoped test account token, never a privileged key.
 */
export async function probeDexie(fetchImpl = fetch, token) {
  const results = [];
  for (const [step, path, bearer] of [
    ['dexie-public', '/public/roles', undefined],
    ['dexie-account-read', '/all/realms', token],
  ]) {
    if (step === 'dexie-account-read' && !bearer) {
      results.push({ step, code: 'NOT_CONFIGURED', status: null }); continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(DB_ORIGIN + path, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      });
      const ok = response.ok && (response.headers.get('content-type') ?? '').includes('application/json');
      // Never serialize record values, participants, error bodies or bearer URLs.
      await response.body?.cancel();
      results.push({ step, code: ok ? 'OK' : response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', status: response.status });
    } catch {
      results.push({ step, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', status: null });
    } finally { clearTimeout(timer); }
  }
  return { version: 'comm02-gateway-1', networkOnly: true, authorizationDesignProven: false, results };
}

/** Yandex Cloud Functions Node.js HTTP handler; no unauthenticated upstream proxy. */
export async function handler(event) {
  const reply = (statusCode, code, report) => ({ statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(report ?? { code }),
  });
  const configured = process.env.COMM02_PROBE_SECRET;
  if (!configured || configured.length < 32) return reply(503, 'PROBE_NOT_CONFIGURED');
  const supplied = event?.headers?.authorization ?? event?.headers?.Authorization;
  if (typeof supplied !== 'string' || supplied.length > 1024
    || !timingSafeEqual(digest(supplied), digest(`Bearer ${configured}`))) return reply(401, 'PROBE_AUTH_REQUIRED');
  if (event.httpMethod !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
  const report = await probeDexie(fetch, process.env.COMM02_DEXIE_READ_TOKEN);
  const codes = report.results.map(result => result.code);
  return reply(codes.every(code => code === 'OK') ? 200
    : codes.includes('TIMEOUT') ? 504 : codes.includes('NOT_CONFIGURED') ? 503 : 502, null, report);
}
