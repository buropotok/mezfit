// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCoachClientAvatar } from './coach-client-avatar';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local coach photo compression', () => {
  it('converts a selected image to bounded JPEGs without network or Worker requests', async () => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:local-coach-avatar');
      static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal('Image', class {
      naturalWidth = 1024;
      naturalHeight = 512;
      onload?: () => void;
      onerror?: () => void;
      set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    });

    const nativeCreateElement = document.createElement.bind(document);
    const canvas = nativeCreateElement('canvas');
    const drawImage = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      drawImage, clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(128)], { type: 'image/jpeg' }));
    });
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : nativeCreateElement(tag)) as typeof document.createElement);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array(1024)], 'client.png', { type: 'image/png' });
    const { small, large } = await prepareCoachClientAvatar(file);
    expect(small.type).toBe('image/jpeg');
    expect(large.type).toBe('image/jpeg');
    expect(small.size).toBeLessThanOrEqual(50_000);
    expect(large.size).toBeLessThanOrEqual(245_000);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('canvas');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-coach-avatar');
  });

  it('rejects invalid or oversized files before decoding', async () => {
    await expect(prepareCoachClientAvatar(new File(['text'], 'x.txt', { type: 'text/plain' })))
      .rejects.toThrow('INVALID_AVATAR_FILE');
    await expect(prepareCoachClientAvatar(new File(
      [new Uint8Array(20_000_001)], 'huge.jpg', { type: 'image/jpeg' },
    ))).rejects.toThrow('INVALID_AVATAR_FILE');
  });
});
