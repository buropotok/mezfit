// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoReview } from './DiscussionVideoReview';
import { trimRecordedWebm } from '../media/videoTrimWebm';
import { reportVideoRecordingFailure } from '../video-note/video-recording-diagnostics';

vi.mock('../media/videoTrim', () => ({
  MIN_VIDEO_TRIM_SECONDS: 0.2,
  inspectVideoTrim: async () => ({ duration: 12, timelineStart: 0 }),
  trimRecordedMp4: vi.fn(),
}));
vi.mock('../media/videoTrimWebm', () => ({ trimRecordedWebm: vi.fn() }));
vi.mock('../video-note/video-recording-diagnostics', () => ({ reportVideoRecordingFailure: vi.fn() }));
vi.mock('./useVideoTrimFilmstrip', () => ({
  VIDEO_TRIM_FRAME_COUNT: 8,
  useVideoTrimFilmstrip: () => [],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount() {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: () => 'blob:webm-preview',
    revokeObjectURL: () => {},
  }));
  const onUse = vi.fn<(file: File) => void>();
  const onTrimFallback = vi.fn<(message: string) => void>();
  render(<DiscussionVideoReview
    clip={{ blob: new Blob(['source'], { type: 'video/webm' }), mimeType: 'video/webm', durationMs: 12_000 }}
    onUse={onUse} onRetake={() => {}} onTrimFallback={onTrimFallback} profile="portrait"
    confirmStyle={{}} retakeStyle={{}}
  />);
  return { onUse, onTrimFallback };
}

it('shows the specified toast and forwards the trimmed WebM when precise encoding fails', async () => {
  const result = new Blob(['trimmed'], { type: 'video/webm' });
  vi.mocked(trimRecordedWebm).mockImplementation(async (_blob, _info, _range, _signal, onExactFailed) => {
    onExactFailed?.('NotSupportedError');
    return { blob: result, mode: 'keyframe' };
  });
  const { onUse, onTrimFallback } = mount();
  const start = await screen.findByRole('slider', { name: 'Начало отрезка' });
  fireEvent.change(start, { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Использовать видео' }));
  await waitFor(() => expect(onUse).toHaveBeenCalledOnce());

  expect(onTrimFallback).toHaveBeenCalledExactlyOnceWith(
    'На вашем устройстве возможна обрезка только по ключевым кадрам',
  );
  const saved = onUse.mock.calls[0][0];
  expect(saved.name).toBe('Видео.webm');
  expect(saved.type).toBe('video/webm');
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith(
    'WEBM_EXACT_TRIM_FAILED', 'portrait', expect.objectContaining({ trimFallbackCause: 'NotSupportedError' }),
  );
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith(
    'WEBM_KEYFRAME_FALLBACK', 'portrait', expect.anything(),
  );
});

it('keeps the exact WebM path silent when encoding succeeds', async () => {
  vi.mocked(trimRecordedWebm).mockResolvedValue({
    blob: new Blob(['exact'], { type: 'video/webm' }), mode: 'exact',
  });
  const { onUse, onTrimFallback } = mount();
  fireEvent.change(await screen.findByRole('slider', { name: 'Начало отрезка' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Использовать видео' }));
  await waitFor(() => expect(onUse).toHaveBeenCalledOnce());
  expect(onTrimFallback).not.toHaveBeenCalled();
  expect(reportVideoRecordingFailure).not.toHaveBeenCalled();
});
