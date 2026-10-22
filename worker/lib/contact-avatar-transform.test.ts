import { describe, expect, it, vi } from 'vitest';
import { AVATAR_LIMITS, optimizeContactAvatar } from './contact-avatar-transform';

const jpeg = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

function images(size: (width: number, quality: number) => number) {
  const renders: Array<{ width: number; quality: number }> = [];
  const input = vi.fn((_stream: ReadableStream<Uint8Array>) => ({
    transform({ width }: { width: number }) {
      return {
        async output({ quality }: { quality: number }) {
          renders.push({ width, quality });
          return {
            response: () => new Response(jpeg(size(width, quality)), {
              headers: { 'content-type': 'image/jpeg' },
            }),
          };
        },
      };
    },
  }));
  return { images: { input } as unknown as Pick<ImagesBinding, 'input'>, input, renders };
}

describe('server-side Telegram avatar optimization', () => {
  it('accepts a source larger than the old 256 KB cap and encodes both bounded copies', async () => {
    const codec = images((width, quality) => width === 512
      ? (quality >= 85 ? 280_000 : 205_000)
      : (quality >= 80 ? 60_000 : 32_000));
    const original = jpeg(900_000).buffer;
    const small = await optimizeContactAvatar(codec.images, original, 'small');
    const large = await optimizeContactAvatar(codec.images, original, 'large');
    expect(small?.byteLength).toBe(32_000);
    expect(large?.byteLength).toBe(205_000);
    expect(small!.byteLength).toBeLessThanOrEqual(AVATAR_LIMITS.small.bytes);
    expect(large!.byteLength).toBeLessThanOrEqual(AVATAR_LIMITS.large.bytes);
    expect(codec.renders).toMatchObject([
      { width: 128, quality: 80 }, { width: 128, quality: 65 },
      { width: 512, quality: 85 }, { width: 512, quality: 70 },
    ]);
    expect(codec.input).toHaveBeenCalledTimes(4);
  });

  it('reduces resolution further when lowering quality is not enough', async () => {
    const codec = images((width) => width > 64 ? 320_000 : 18_000);
    const result = await optimizeContactAvatar(codec.images, jpeg(50_000).buffer, 'small');
    expect(result?.byteLength).toBe(18_000);
    expect(codec.renders.at(-1)?.width).toBe(64);
  });

  it('never returns bytes above the variant maximum', async () => {
    const codec = images(() => 350_000);
    expect(await optimizeContactAvatar(codec.images, jpeg(400_000).buffer, 'large')).toBeNull();
    expect(codec.renders).toHaveLength(5);
  });

  it('rejects invalid sources before invoking Images', async () => {
    const codec = images(() => 30_000);
    expect(await optimizeContactAvatar(codec.images, new Uint8Array(100).buffer, 'small')).toBeNull();
    expect(codec.input).not.toHaveBeenCalled();
  });
});
