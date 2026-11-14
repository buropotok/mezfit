// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { VIDEO_RECORDING_MIME_TYPES } from '../../shared/video-recording-diagnostic';
import { collectVideoRecordingDiagnostic, reportVideoRecordingFailure } from './video-recording-diagnostics';
import { getTelegramWebApp } from '../telegram';
import { sendVideoRecordingDiagnostic } from '../api';

vi.mock('../api', () => ({ sendVideoRecordingDiagnostic: vi.fn(async () => {}) }));
vi.mock('../telegram', () => ({
  getTelegramWebApp: vi.fn(() => ({
    initData: 'private-telegram-init-data',
    platform: 'android',
    version: '10.1',
    initDataUnsafe: { user: { id: 1234, first_name: 'PRIVATE' } },
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(sendVideoRecordingDiagnostic).mockClear();
});

it('records all supported MIME checks and technical device details without personal Telegram data', () => {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (mime: string) => mime === 'video/mp4',
  });
  const report = collectVideoRecordingDiagnostic('UNSUPPORTED_MP4_AVC', 'portrait');
  expect(Object.keys(report.mimeSupport)).toEqual([...VIDEO_RECORDING_MIME_TYPES]);
  expect(report.mimeSupport['video/mp4']).toBe('yes');
  expect(report.mimeSupport['video/mp4;codecs=avc1']).toBe('no');
  expect(report.device.telegramPlatform).toBe('android');
  expect(report.device.telegramVersion).toBe('10.1');
  expect(JSON.stringify(report)).not.toContain('private-telegram-init-data');
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
  expect(JSON.stringify(report)).not.toContain('1234');
});

it('sends only to the authenticated API client and never exposes recipient or personal data in the payload', () => {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false });
  reportVideoRecordingFailure('CAMERA_ACCESS_FAILED', 'circle', { errorName: 'NotAllowedError' });
  expect(getTelegramWebApp).toHaveBeenCalled();
  expect(sendVideoRecordingDiagnostic).toHaveBeenCalledOnce();
  const [initData, diagnostic] = vi.mocked(sendVideoRecordingDiagnostic).mock.calls[0];
  expect(initData).toBe('private-telegram-init-data');
  expect(diagnostic.device.errorName).toBe('NotAllowedError');
  expect(JSON.stringify(diagnostic)).not.toContain('208192415');
});
