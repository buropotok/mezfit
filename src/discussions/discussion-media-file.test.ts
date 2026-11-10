// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { inspectDiscussionMedia } from './discussion-media-file';
import { compressGalleryVideo } from './video-compression';

vi.mock('./video-compression', () => ({ compressGalleryVideo: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockGalleryVideoProbe() {
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:gallery');
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal('crypto', {
    randomUUID: () => 'test-uuid',
    getRandomValues: (bytes: Uint8Array) => { bytes.fill(5); return bytes; },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: ElementCreationOptions) => {
    const element = createElement(name, options);
    if (name === 'video') {
      Object.defineProperties(element, {
        duration: { configurable: true, value: 120 },
        videoWidth: { configurable: true, value: 1920 },
        videoHeight: { configurable: true, value: 1080 },
      });
      queueMicrotask(() => {
        element.dispatchEvent(new Event('loadedmetadata'));
        element.dispatchEvent(new Event('loadeddata'));
      });
    }
    return element;
  }) as typeof document.createElement);
}

it('allows a 425 MiB gallery video when local compression yields a valid smaller playable file', async () => {
  mockGalleryVideoProbe();
  const original = new File(['source'], 'workout.mp4', { type: 'video/mp4' });
  Object.defineProperty(original, 'size', { value: 425 * 1024 * 1024 });
  const output = new File(['compressed'], 'workout-compressed.webm', { type: 'video/webm' });
  vi.mocked(compressGalleryVideo).mockResolvedValue(output);
  const result = await inspectDiscussionMedia(original, new AbortController().signal);
  expect(compressGalleryVideo).toHaveBeenCalledWith(original, {
    durationSeconds: 120, width: 1920, height: 1080,
  }, expect.any(AbortSignal));
  expect(result.file).toBe(output);
  expect(result.compressed).toBe(true);
  expect(result.metadata).toMatchObject({ mediaType: 'video', mimeType: 'video/webm',
    sizeBytes: output.size, durationSeconds: 120, fileName: output.name });
});

it('does not upload a 425 MiB source if the local encoder is unavailable', async () => {
  mockGalleryVideoProbe();
  const original = new File(['source'], 'workout.mp4', { type: 'video/mp4' });
  Object.defineProperty(original, 'size', { value: 425 * 1024 * 1024 });
  vi.mocked(compressGalleryVideo).mockResolvedValue(null);
  await expect(inspectDiscussionMedia(original, new AbortController().signal))
    .rejects.toThrow('Устройство не смогло сжать видео');
});
