import type { TelegramInitUser } from './telegram';
import { sha256Hex } from './tokens';
import {
  cancelInviteConsent, claimInviteConsent, inviteRegistrationStatus, openInviteConsent,
  readInviteConsent, releaseInviteClaim,
} from './telegram-invite-consent';

export const BOT_WEBHOOK_PATH = '/api/telegram/bot-webhook';
const WEB_URL = 'https://mezfit.online/';
const WEB_LOGIN_URL = WEB_URL + 'auth/telegram-login';
const MAX_BODY_BYTES = 32 * 1024;
const SECRET_FORMAT = /^[A-Za-z0-9_-]{1,256}$/;
const CALLBACK_DATA = /^([acs])\.([a-f0-9]{32})\.([a-f0-9]{24})$/;
const UNAVAILABLE = 'Приглашение недействительно или истекло. Попросите тренера отправить новую ссылку.';
const SELF_LINK = 'Вы не можете принять собственное приглашение.';

type Action = 'a' | 'c' | 's';
type Button = { text: string } & (
  { callback_data: string } | { url: string } | { login_url: { url: string } }
);
type Message = { chat_id: number; text: string; reply_markup: { inline_keyboard: Button[][] } };
type TelegramCall =
  | { method: 'sendMessage'; payload: Message }
  | { method: 'editMessageText'; payload: Message & { message_id: number } }
  | { method: 'answerCallbackQuery'; payload: { callback_query_id: string } };

type Update =
  | { kind: 'start'; user: TelegramInitUser; messageId: number; date: number; parameter: string }
  | { kind: 'callback'; user: TelegramInitUser; messageId: number; callbackId: string; data: string };

export function botInviteLinksEnabled(env: Env): boolean {
  return env.TELEGRAM_BOT_INVITES_ENABLED === 'true'
    && Boolean(env.TELEGRAM_BOT_TOKEN && SECRET_FORMAT.test(env.TELEGRAM_BOT_WEBHOOK_SECRET ?? ''));
}

export class InviteAcceptanceError extends Error {
  constructor(readonly code: 'INVITE_UNAVAILABLE' | 'SELF_LINK') {
    super(code);
  }
}

interface InvitationService {
  preview(parameter: string, actor: string): Promise<{ id: number; coachName: string }>;
  accept(tokenHash: string, actor: TelegramInitUser, consentId: string): Promise<void>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseActor(value: unknown): TelegramInitUser | null {
  if (!object(value) || !id(value.id) || value.is_bot !== false
    || typeof value.first_name !== 'string' || !value.first_name.trim() || value.first_name.length > 256) return null;

  const user: TelegramInitUser = { id: value.id, first_name: value.first_name };
  for (const field of ['last_name', 'username', 'language_code'] as const) {
    const entry = value[field];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || entry.length > (field === 'language_code' ? 64 : 256)) return null;
    user[field] = entry;
  }
  if (value.is_premium !== undefined && typeof value.is_premium !== 'boolean') return null;
  if (value.is_premium === true) user.is_premium = true;
  return user;
}

function privateMessage(value: unknown, user: TelegramInitUser) {
  if (!object(value) || !id(value.message_id) || !id(value.date)
    || !object(value.chat) || value.chat.type !== 'private' || value.chat.id !== user.id) return null;
  return { messageId: value.message_id, date: value.date, text: value.text };
}

function parseUpdate(update: Record<string, unknown>): Update | null {
  if (object(update.callback_query) && update.message === undefined) {
    const query = update.callback_query;
    const user = parseActor(query.from);
    const message = user && privateMessage(query.message, user);
    if (!user || !message || query.inline_message_id !== undefined
      || typeof query.id !== 'string' || !/^[!-~]{1,128}$/.test(query.id)
      || typeof query.data !== 'string' || !CALLBACK_DATA.test(query.data)) return null;
    return { kind: 'callback', user, messageId: message.messageId, callbackId: query.id, data: query.data };
  }

  if (!object(update.message) || update.callback_query !== undefined) return null;
  const user = parseActor(update.message.from);
  const message = user && privateMessage(update.message, user);
  if (!user || !message || typeof message.text !== 'string') return null;
  const start = /^\/start(?:\s+([^\s]+))?\s*$/.exec(message.text);
  return start ? {
    kind: 'start', user, messageId: message.messageId, date: message.date, parameter: start[1] ?? '',
  } : null;
}

async function readUpdate(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    await request.body?.cancel();
    return undefined;
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  } finally {
    reader.releaseLock();
  }
}

function equalDigest(left: string, right: string): boolean {
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function callbackData(secret: string, action: Action, consentId: string, actor: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const input = `mezfit:telegram-bot-invite:v1:${actor}:${action}:${consentId}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  const tag = Array.from(new Uint8Array(signature, 0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${action}.${consentId}.${tag}`;
}

class TelegramDeliveryError extends Error {
  constructor(readonly code: 'BOT_API_UNAVAILABLE' | 'BOT_API_REJECTED') {
    super(code);
  }
}

async function telegram(token: string, { method, payload }: TelegramCall): Promise<void> {
  const signal = AbortSignal.timeout(method === 'answerCallbackQuery' ? 2_000 : 5_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result: unknown = await response.json().catch(() => null);
    if (response.ok && object(result) && result.ok === true) {
      const success = method === 'answerCallbackQuery' ? result.result === true
        : object(result.result) && id(result.result.message_id);
      if (success) return;
    }
    // A repeated edit can follow a lost response after Telegram applied it.
    if (method === 'editMessageText' && response.status === 400 && object(result)
      && result.ok === false && result.error_code === 400 && typeof result.description === 'string'
      && result.description.startsWith('Bad Request: message is not modified')) return;
    if (response.status === 429 || response.status >= 500 || response.ok) {
      throw new TelegramDeliveryError('BOT_API_UNAVAILABLE');
    }
    throw new TelegramDeliveryError('BOT_API_REJECTED');
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error;
    throw new TelegramDeliveryError('BOT_API_UNAVAILABLE');
  }
}

function inviteErrorText(error: unknown): string | null {
  if (!(error instanceof InviteAcceptanceError)) return null;
  return error.code === 'SELF_LINK' ? SELF_LINK : UNAVAILABLE;
}

async function handleUpdate(update: Update, env: Env, secret: string, invitations: InvitationService) {
  const actor = String(update.user.id);
  const db = env.DB_BINDING;
  const send = (text: string, keyboard: Button[][] = []) => {
    const payload: Message = { chat_id: update.user.id, text, reply_markup: { inline_keyboard: keyboard } };
    return update.kind === 'start'
      ? telegram(env.TELEGRAM_BOT_TOKEN, { method: 'sendMessage', payload })
      : telegram(env.TELEGRAM_BOT_TOKEN, {
        method: 'editMessageText', payload: { ...payload, message_id: update.messageId },
      });
  };
  const button = async (text: string, action: Action, consentId: string): Promise<Button> => ({
    text, callback_data: await callbackData(secret, action, consentId, actor),
  });
  const appButton = { text: 'Открыть Mezfit', url: WEB_URL };

  if (update.kind === 'start') {
    if (!update.parameter) return send('Добро пожаловать в Mezfit. Чтобы подключиться к тренеру, откройте ссылку-приглашение.', [[appButton]]);
    if (update.parameter !== 'invite' && !update.parameter.startsWith('invite_')) return;
    let preview: Awaited<ReturnType<InvitationService['preview']>>;
    try {
      preview = await invitations.preview(update.parameter, actor);
    } catch (error) {
      const text = inviteErrorText(error);
      if (text) return send(text);
      throw error;
    }
    const consent = await openInviteConsent(db, actor, update.messageId, preview.id, update.date);
    if (consent?.state === 'offered') {
      return send(`Вы получили приглашение от тренера ${preview.coachName}.`, [[
        await button('Принять', 'a', consent.id), await button('Отмена', 'c', consent.id),
      ]]);
    }
    return;
  }

  const [, action, consentId] = CALLBACK_DATA.exec(update.data) ?? [];
  if (action !== 'a' && action !== 'c' && action !== 's') return;
  if (!equalDigest(await callbackData(secret, action, consentId, actor), update.data)) return;

  await telegram(env.TELEGRAM_BOT_TOKEN, {
    method: 'answerCallbackQuery', payload: { callback_query_id: update.callbackId },
  }).catch(() => {
    // Callback acknowledgements expire and may have already succeeded on delivery retry.
  });

  if (action === 'c') await cancelInviteConsent(db, consentId, actor);
  const consent = await readInviteConsent(db, consentId, actor);
  if (!consent) return send('Предложение истекло. Откройте ссылку-приглашение снова.');
  if (consent.state === 'cancelled') return send('Приглашение отменено. Вы можете открыть ссылку снова.');

  if (consent.state !== 'accepted') {
    if (action !== 'a') return;
    const claim = await claimInviteConsent(db, consentId, actor);
    if (claim === null) {
      // A concurrent acceptance owns this offer. Its response will update the message.
      return;
    }
    try {
      await invitations.accept(consent.token_hash, update.user, consentId);
    } catch (error) {
      // D1 can commit the batch even if the Worker loses the response.
      const persisted = await readInviteConsent(db, consentId, actor);
      if (persisted?.state !== 'accepted') {
        await releaseInviteClaim(db, consentId, claim);
        const text = inviteErrorText(error);
        if (text) return send(text);
        console.warn('TELEGRAM_INVITE_ACCEPT_FAILED', error instanceof Error && 'code' in error
          && typeof error.code === 'string' && /^CLOUD_MEMBERSHIP_[A-Z_]+$/.test(error.code) ? error.code : 'INVITE_WRITE_FAILED');
        return send('Не удалось завершить принятие приглашения. Попробуйте ещё раз.', [[
          await button('Повторить принятие', 'a', consentId),
        ]]);
      }
    }
  }

  const status = await inviteRegistrationStatus(env, consentId, actor);
  if (!status) return send('Связь с тренером недоступна. Попросите тренера отправить новое приглашение.');
  if (!status.ready) {
    return send('Приглашение принято. Подготавливаем доступ. Проверьте готовность чуть позже.', [[
      await button('Проверить готовность', 's', consentId),
    ]]);
  }
  const readyButton: Button = env.TELEGRAM_BOT_LOGIN_URL_ENABLED === 'true'
    ? { text: appButton.text, login_url: { url: WEB_LOGIN_URL } } : appButton;
  return send(`Приглашение принято! Ваш тренер — ${status.coachName}. Веб-интерфейс будет подключён отдельно.`, [
    [readyButton],
    [{ text: 'Открыть Mini App', url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp` }],
  ]);
}

export async function handleTelegramBotWebhook(request: Request, env: Env, invitations: InvitationService): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const secret = env.TELEGRAM_BOT_WEBHOOK_SECRET;
  if (!secret || !SECRET_FORMAT.test(secret) || !env.TELEGRAM_BOT_TOKEN) return new Response(null, { status: 503 });
  const supplied = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!SECRET_FORMAT.test(supplied) || !equalDigest(await sha256Hex(secret), await sha256Hex(supplied))) {
    return new Response(null, { status: 401 });
  }

  const body = await readUpdate(request);
  if (body === undefined) return new Response(null, { status: 413 });
  if (!object(body) || !id(body.update_id)) return new Response(null, { status: 400 });
  const update = parseUpdate(body);
  if (!update) return new Response(null, { status: 200 });
  try {
    await handleUpdate(update, env, secret, invitations);
    return new Response(null, { status: 200 });
  } catch (error) {
    const code = error instanceof TelegramDeliveryError ? error.code : 'BOT_INVITE_HANDLER_FAILED';
    console.warn(code);
    return new Response(null, { status: code === 'BOT_API_REJECTED' ? 200 : 503 });
  }
}
