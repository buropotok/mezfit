import { expect, it, vi } from 'vitest';
import { APP_ERROR_CODES } from '../../shared/app-error-codes';
import { formatVideoRecordingDiagnostic, handleVideoRecordingDiagnostic } from './video-recording-diagnostic';

vi.mock('./telegram', () => ({
  validateTelegramInitData: vi.fn(async () => ({ user: { id: 989898 } })),
}));

const env: Pick<Env, 'TELEGRAM_BOT_TOKEN' | 'VIDEO_RECORDING_REPORT_CHAT_ID'> = {
  TELEGRAM_BOT_TOKEN: 'dummy-telegram-bot-token',
  VIDEO_RECORDING_REPORT_CHAT_ID: '208192415',
};

it('accepts media inspection reports without passing private fields to Telegram', async () => {
  const post = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  const report = {
    errorCode: APP_ERROR_CODES.MEDIA_VIDEO_METADATA_INVALID,
    profile: 'media',
    mimeSupport: {},
    device: {
      mediaMimeType: 'video/mp4',
      mediaErrorCode: '0',
      mediaReadyState: '1',
      mediaSizeBytes: '12345',
      sourceUrl: 'https://secret.example/private',
      messageId: 'private-chat-message',
    },
  };
  const request = new Request('https://mezfit.example/api/diagnostics/video-recording', {
    method: 'POST',
    headers: { 'x-telegram-init-data': 'dummy-signed-init-data', 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  const response = await handleVideoRecordingDiagnostic(request, env, post);
  expect(response.status).toBe(200);
  expect(post).toHaveBeenCalledOnce();
  const payload = JSON.parse(String(post.mock.calls[0][1]?.body));
  expect(payload.text).toContain('MEDIA_VIDEO_METADATA_INVALID');
  expect(payload.text).toContain('mediaMimeType: video/mp4');
  expect(payload.text).not.toContain('private-chat-message');
  expect(payload.text).not.toContain('secret.example');
});

it('labels the media profile without changing the legacy recorder report format', () => {
  const diagnostic = {
    errorCode: APP_ERROR_CODES.MEDIA_VIDEO_DECODE_FAILED,
    profile: 'media' as const,
    mimeSupport: {},
    device: { telegramPlatform: 'ios' },
  };
  const markup = formatVideoRecordingDiagnostic(diagnostic);
  expect(markup).toContain('Ошибка медиа');
  expect(markup).toContain('MEDIA_VIDEO_DECODE_FAILED');
});
