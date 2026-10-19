import { validateTelegramInitData } from './telegram';

function failure(status: number, code: string): Response {
  return Response.json({ error: { code, message: code } }, {
    status, headers: { 'cache-control': 'no-store' },
  });
}

/** Do not use legacy D1 identity for Dexie scheduling. */
export async function handleCloudSchedulingConfirm(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED');
  const identity = await validateTelegramInitData(
    request.headers.get('x-telegram-init-data') ?? '', env.TELEGRAM_BOT_TOKEN,
  );
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 262_144) return failure(413, 'SCHEDULE_TOO_LARGE');
  const source = await request.text();
  if (source.length > 262_144) return failure(413, 'SCHEDULE_TOO_LARGE');
  let command: unknown;
  try { command = JSON.parse(source); }
  catch { return failure(400, 'INVALID_JSON'); }
  const id = env.SCHEDULE_RESERVATIONS.idFromName('all-workout-bookings-v1');
  const stub = env.SCHEDULE_RESERVATIONS.get(id);
  return stub.fetch('https://schedule.internal/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'tg:' + identity.user.id, input: command }),
  });
}
