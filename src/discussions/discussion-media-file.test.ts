// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { inspectDiscussionMedia } from './discussion-media-file';
import { reportVideoRecordingFailure } from '../video-note/video-recording-diagnostics';

vi.mock('../video-note/video-recording-diagnostics', () => ({
  reportVideoRecordingFailure: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setupVideoProbe() {
  const video = document.createElement('video');
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name: string, options?: ElementCreationOptions) =>
    name === 'video' ? video : createElement(name, options));
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: () => 'blob:local-test-video',
    revokeObjectURL: () => {},
  }));
  const file = new File(['video-bytes'], 'video.mp4', { type: 'video/mp4' });
  return { video, inspect: () => inspectDiscussionMedia(file, new AbortController().signal) };
}

it('distinguishes an immediate decoder error from metadata and timeout', async () => {
  const { video, inspect } = setupVideoProbe();
  const result = inspect();
  video.onerror?.(new Event('error'));
  await expect(result).rejects.toThrow('(Код: MEDIA_VIDEO_DECODE_FAILED)');
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith(
    'MEDIA_VIDEO_DECODE_FAILED', 'media', expect.objectContaining({ mediaMimeType: 'video/mp4' }),
  );
});

it('marks a rejected metadata result separately from browser decoder failure', async () => {
  const { video, inspect } = setupVideoProbe();
  const result = inspect();
  video.onloadedmetadata?.(new Event('loadedmetadata'));
  await expect(result).rejects.toThrow('(Код: MEDIA_VIDEO_METADATA_INVALID)');
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith(
    'MEDIA_VIDEO_METADATA_INVALID', 'media', expect.anything(),
  );
});
