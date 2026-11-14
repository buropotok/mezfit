import { beforeEach, expect, it, vi } from 'vitest';
import { VIDEO_RECORDING_MIME_TYPES, type VideoRecordingDiagnostic } from '../../shared/video-recording-diagnostic';
import { formatVideoRecordingDiagnostic, handleVideoRecordingDiagnostic } from './video-recording-diagnostic';

const auth = vi.hoisted(() => ({ actor: 400, allowed: true }));
vi.mock('./telegram', () => ({
  validateTelegramInitData: vi.fn(async () => {
    if (!auth.allowed) throw new Error('UNAUTHORIZED');
    return { user: { id: auth.actor } };
  }),
}));

const env: Pick<Env, 'TELEGRAM_BOT_TOKEN' | 'VIDEO_RECORDING_REPORT_CHAT_ID'> = {
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  VIDEO_RECORDING_REPORT_CHAT_ID: '208192415',
};

function diagnostic(): VideoRecordingDiagnostic {
  const mimeSupport: VideoRecordingDiagnostic['mimeSupport'] = {};
  for (const mime of VIDEO_RECORDING_MIME_TYPES) mimeSupport[mime] = 'no';
  return {
    errorCode: 'UNSUPPORTED_MP4_AVC', profile: 'circle', mimeSupport,
    device: {
      userAgent: 'Mozilla/5.0 Android <WebView & device>',
      telegramPlatform: 'android',
      telegramVersion: '10.1',
      screen: '1080x2400',
      isTypeSupported: 'true',
    },
  };
}

function request(body: unknown, initData = 'signed-test-init-data') {
  return new Request('https://mezfit.example/api/diagnostics/video-recording', {
    method: 'POST',
    headers: { 'x-telegram-init-data': initData, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  auth.actor += 1;
  auth.allowed = true;
});

it('sends one rich HTML message with collapsed technical details to the configured chat', async () => {
  const fetchTelegram = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
  const result = await handleVideoRecordingDiagnostic(request(diagnostic()), env, fetchTelegram as typeof fetch);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
  expect(fetchTelegram).toHaveBeenCalledOnce();
  const [url, init] = fetchTelegram.mock.calls[0];
  expect(url).toContain('/sendMessage');
  const payload = JSON.parse(String(init?.body));
  expect(payload.chat_id).toBe('208192415');
  expect(payload.parse_mode).toBe('HTML');
  expect(payload.text).toContain('<blockquote expandable>');
  expect(payload.text).toContain('video/mp4');
  expect(payload.text).toContain('&lt;WebView &amp; device&gt;');
  expect(payload.text).not.toContain('signed-test-init-data');
});

it('drops unapproved private fields instead of forwarding arbitrary client data', async () => {
  const fetchTelegram = vi.fn(async () => Response.json({ ok: true }));
  const report = {
    ...diagnostic(),
    telegramUserId: '999',
    chatMessage: 'do not forward',
    device: { ...diagnostic().device, userId: '999', chatText: 'private text' },
  };
  await handleVideoRecordingDiagnostic(request(report), env, fetchTelegram as typeof fetch);
  const body = JSON.parse(String(fetchTelegram.mock.calls[0][1]?.body));
  expect(body.text).not.toContain('private text');
  expect(body.text).not.toContain('999');
  expect(body.text).not.toContain('do not forward');
});

it('rejects malformed diagnostics without contacting Telegram', async () => {
  const fetchTelegram = vi.fn(async () => Response.json({ ok: true }));
  const response = await handleVideoRecordingDiagnostic(request({ errorCode: 'unknown', profile: 'circle' }), env, fetchTelegram as typeof fetch);
  expect(response.status).toBe(400);
  expect(fetchTelegram).not.toHaveBeenCalled();
});

it('rejects requests that do not verify Telegram initData', async () => {
  auth.allowed = false;
  const fetchTelegram = vi.fn(async () => Response.json({ ok: true }));
  await expect(handleVideoRecordingDiagnostic(request(diagnostic(), ''), env, fetchTelegram as typeof fetch))
    .rejects.toThrow('UNAUTHORIZED');
  expect(fetchTelegram).not.toHaveBeenCalled();
});

it('limits repeated errors from the same authenticated device', async () => {
  const fetchTelegram = vi.fn(async () => Response.json({ ok: true }));
  expect((await handleVideoRecordingDiagnostic(request(diagnostic()), env, fetchTelegram as typeof fetch)).status).toBe(200);
  expect((await handleVideoRecordingDiagnostic(request(diagnostic()), env, fetchTelegram as typeof fetch)).status).toBe(200);
  expect(fetchTelegram).toHaveBeenCalledOnce();
});

it('escapes markup and stays within the Telegram text limit', () => {
  const report = diagnostic();
  report.device.userAgent = '<img src=x onerror="bad">'.repeat(30);
  const html = formatVideoRecordingDiagnostic(report);
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
  expect(html).toContain('</blockquote>');
  expect(html.length).toBeLessThan(4096);
});
