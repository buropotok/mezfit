// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressTelegramAvatar } from './telegram-avatar-compress';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Telegram avatar JavaScript compressor', () => {
  it('creates 128/512 px JPEG variants without network or Cloudflare Images', async () => {
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:telegram-jpeg');
      static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal('Image', class {
      naturalWidth = 1024;
      naturalHeight = 512;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    const canvas = document.createElement('canvas');
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      clearRect, drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(128)], { type: 'image/jpeg' }));
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : createElement(tag)) as typeof document.createElement);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });
    const { small, large } = await compressTelegramAvatar(source);
    expect(small.type).toBe('image/jpeg');
    expect(large.type).toBe('image/jpeg');
    expect(small.size).toBeLessThanOrEqual(50_000);
    expect(large.size).toBeLessThanOrEqual(245_000);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(256);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:telegram-jpeg');
  });

  it('rejects unsupported or oversized sources without attempting to decode them', async () => {
    await expect(compressTelegramAvatar(new Blob(['not a JPEG'], { type: 'image/png' })))
      .rejects.toThrow('INVALID_TELEGRAM_AVATAR_SOURCE');
    await expect(compressTelegramAvatar(new Blob(
      [new Uint8Array(20_000_001)], { type: 'image/jpeg' },
    ))).rejects.toThrow('INVALID_TELEGRAM_AVATAR_SOURCE');
  });
});
