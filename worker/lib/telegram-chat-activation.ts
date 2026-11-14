/** Verify that the authenticated user has an accessible private chat with Mezfit.
 * This is only a messaging-readiness check: it does not alter Dexie Cloud access.
 */
export async function telegramChatIsActivated(
  telegramUserId: string,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!/^[1-9]\d*$/.test(telegramUserId) || !botToken) {
    throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  }

  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramUserId }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  }

  // Unknown private chat or explicitly blocked bot: the user needs to activate it.
  if (response.status === 400 || response.status === 403) return false;
  if (!response.ok) throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE');

  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE'); }
  if (!data || typeof data !== 'object') throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  const payload = data as { ok?: unknown; result?: { type?: unknown; id?: unknown } };
  if (payload.ok !== true || !payload.result || payload.result.type !== 'private'
    || payload.result.id !== Number(telegramUserId)) {
    throw new Error('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  }
  return true;
}
