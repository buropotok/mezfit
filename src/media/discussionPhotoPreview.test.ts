// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDiscussionPhotoPreview } from './discussionPhotoPreview';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('bounds the long side and falls back to actual JPEG bytes when WebP is unsupported', async () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:discussion-photo');
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal('Image', class {
    naturalWidth = 1024;
    naturalHeight = 2048;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    removeAttribute() {}
  });
  const canvas = document.createElement('canvas');
  const drawImage = vi.fn();
  vi.spyOn(canvas, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(canvas, 'toBlob').mockImplementation((callback, format) => {
    callback(new Blob(['preview'], { type: format === 'image/webp' ? 'image/png' : 'image/jpeg' }));
  });
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? canvas : createElement(tag)) as typeof document.createElement);
  const full = new Blob(['original'], { type: 'image/png' });
  const preview = await createDiscussionPhotoPreview(full, new AbortController().signal);

  expect(drawImage).toHaveBeenCalledExactlyOnceWith(expect.anything(), 0, 0, 240, 480);
  expect(encode.mock.calls.map(([, type]) => type)).toEqual(['image/webp', 'image/jpeg']);
  expect(preview).toMatchObject({ size: 7, type: 'image/jpeg' });
  expect(full).toMatchObject({ size: 8, type: 'image/png' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:discussion-photo');
});
