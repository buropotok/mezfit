import { validateTelegramInitData } from './telegram';
import {
  VIDEO_RECORDING_DEVICE_FIELDS, VIDEO_RECORDING_ERROR_CODES,
  VIDEO_RECORDING_MIME_TYPES, type VideoRecordingDiagnostic,
} from '../../shared/video-recording-diagnostic';

type DiagnosticEnv = Pick<Env, 'TELEGRAM_BOT_TOKEN' | 'VIDEO_RECORDING_REPORT_CHAT_ID'>;
const lastReportByActorAndEvent = new Map<string, number>();
const MIN_INTERVAL_MS = 15_000;
const MAX_BODY_CHARS = 8_000;

const errorLabels: Record<VideoRecordingDiagnostic['errorCode'], string> = {
  UNSUPPORTED_MP4_AVC: 'Не найден поддерживаемый MP4/H.264',
  MEDIA_API_UNAVAILABLE: 'Недоступны MediaRecorder или getUserMedia',
  CAMERA_ACCESS_FAILED: 'Ошибка доступа к камере/микрофону',
  CAMERA_INTERRUPTED: 'Получение видеопотока прервано',
  CAMERA_PREVIEW_NOT_READY: 'Изображение камеры ещё не готово',
  CAMERA_ORIENTATION: 'Ориентация видеопотока не совпала',
  RECORDER_START_FAILED: 'MediaRecorder не запустился',
  RECORDER_RUNTIME_FAILED: 'Ошибка во время записи',
  RECORDER_STOP_FAILED: 'Не удалось завершить запись',
  RECORDER_INTERRUPTED: 'Запись была прервана',
  RECORDING_EMPTY: 'Получен пустой видеофайл',
  RECORDED_FORMAT_INVALID: 'Фактический формат записи не подходит редактору',
  WEBM_AUTO_FALLBACK: 'MP4 недоступен — выбран WebM',
  WEBM_RUNTIME_FALLBACK: 'MP4 не запустился — выбран WebM',
  WEBM_FORCED_MODE: 'Принудительно выбран WebM для тестирования',
  WEBM_EXACT_TRIM_FAILED: 'Точная обрезка WebM недоступна',
  WEBM_KEYFRAME_FALLBACK: 'WebM обрезан по ключевым кадрам вместо точного режима',
  WEBM_TRIM_FAILED: 'Все способы обрезки WebM завершились ошибкой',
  WEBM_TRIM_INSPECTION_FAILED: 'Не удалось прочитать WebM в редакторе',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDiagnostic(raw: unknown): VideoRecordingDiagnostic | null {
  if (!isRecord(raw) || !isRecord(raw.device) || !isRecord(raw.mimeSupport)) return null;
  if (!VIDEO_RECORDING_ERROR_CODES.some(code => code === raw.errorCode)) return null;
  if (raw.profile !== 'circle' && raw.profile !== 'portrait' && raw.profile !== 'landscape') return null;
  const mimeSupport: VideoRecordingDiagnostic['mimeSupport'] = {};
  for (const mime of VIDEO_RECORDING_MIME_TYPES) {
    const value = raw.mimeSupport[mime];
    mimeSupport[mime] = value === 'yes' || value === 'no' || value === 'unavailable' ? value : 'unavailable';
  }
  const device: VideoRecordingDiagnostic['device'] = {};
  for (const field of VIDEO_RECORDING_DEVICE_FIELDS) {
    const value = raw.device[field];
    if (typeof value === 'string') device[field] = value.slice(0, field === 'userAgent' ? 480 : 160);
  }
  return { errorCode: raw.errorCode as VideoRecordingDiagnostic['errorCode'],
    profile: raw.profile, mimeSupport, device };
}

function html(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatVideoRecordingDiagnostic(report: VideoRecordingDiagnostic): string {
  const title = errorLabels[report.errorCode];
  const platform = report.device.telegramPlatform ?? report.device.platform ?? 'unknown';
  const header = [
    '🚨 <b>Mezfit · Ошибка видеозаписи</b>',
    '<b>' + html(title) + '</b>',
    'Код: <code>' + report.errorCode + '</code>',
    'Telegram: <code>' + html(platform) + '</code> · ' + html(report.profile),
    'Время (UTC): <code>' + new Date().toISOString() + '</code>',
  ].join('\n');
  const lines = [
    'Проверка MIME-типов:',
    ...VIDEO_RECORDING_MIME_TYPES.map(type => type + ': ' + (report.mimeSupport[type] ?? 'unavailable')),
    '',
    'Устройство и WebView:',
    ...VIDEO_RECORDING_DEVICE_FIELDS.flatMap(key =>
      report.device[key] === undefined ? [] : [key + ': ' + report.device[key]]),
  ];
  // Telegram sendMessage limits the parsed text to 4096 characters. Keep room for markup.
  const details: string[] = [];
  for (const line of lines) {
    const escaped = html(line);
    if (details.join('\n').length + escaped.length > 2_700) {
      details.push('… дополнительные поля сокращены');
      break;
    }
    details.push(escaped);
  }
  return header + '\n\n<b>Подробная диагностика устройства:</b>\n<blockquote expandable>'
    + details.join('\n') + '</blockquote>';
}

/** Authenticated, optional, rate-limited server-side notification. No actor/chat/media identifiers in the message. */
export async function handleVideoRecordingDiagnostic(
  request: Request, env: DiagnosticEnv, fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const chatId = env.VIDEO_RECORDING_REPORT_CHAT_ID;
  if (!chatId || !/^\d{5,20}$/.test(chatId)) return new Response(null, { status: 503 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 });
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_CHARS) return new Response(null, { status: 413 });
  // Verify the Telegram request before processing user-controlled diagnostic content.
  const telegram = await validateTelegramInitData(
    request.headers.get('x-telegram-init-data') ?? '', env.TELEGRAM_BOT_TOKEN,
  );
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_CHARS) return new Response(null, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); }
  catch { return new Response(null, { status: 400 }); }
  const diagnostic = parseDiagnostic(parsed);
  if (!diagnostic) return new Response(null, { status: 400 });

  const now = Date.now();
  const actor = telegram.user.id;
  const eventKey = actor + ':' + diagnostic.errorCode;
  const previous = lastReportByActorAndEvent.get(eventKey);
  if (previous !== undefined && now - previous < MIN_INTERVAL_MS) {
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (lastReportByActorAndEvent.size > 512) lastReportByActorAndEvent.clear();
  lastReportByActorAndEvent.set(eventKey, now);

  try {
    const response = await fetchImpl('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatVideoRecordingDiagnostic(diagnostic),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return new Response(null, { status: 502 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Never log Bot API URLs, signed initData, personal data or raw Telegram errors.
    return new Response(null, { status: 502 });
  }
}
