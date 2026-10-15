import { afterEach, describe, expect, it, vi } from 'vitest';

const frontManifest = {
  view: 'front',
  width: 1024,
  height: 1536,
  tonePercent: 84,
  sprites: {
    '1': {
      index: 1, id: 'pectoralis_clavicular', label: 'Верх груди', category: 'Грудь',
      atlasX: 0, atlasY: 0, targetX: 50, targetY: 80, width: 20, height: 30,
    },
  },
};

function setUpAssets() {
  const mask = new Uint8Array(16 + 1024 * 1536);
  for (let i = 0; i < 8; i += 1) mask[i] = 'MEZMASK1'.charCodeAt(i);
  const header = new DataView(mask.buffer);
  header.setUint32(8, 1024, true);
  header.setUint32(12, 1536, true);
  mask[16 + 80 * 1024 + 50] = 1;
  let imageCreations = 0;

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(url: string) {
      imageCreations += 1;
      this.naturalWidth = url.includes('neutral.png') ? 1024 : 1983;
      this.naturalHeight = url.includes('neutral.png') ? 1536 : 1207;
      queueMicrotask(() => this.onload?.());
    }
    async decode() { return undefined; }
  }

  // Lightweight fetch response with exactly the operations our loader uses.
  const responseFor = (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => frontManifest,
    arrayBuffer: async () => mask.buffer,
  });
  const fetchSpy = vi.fn(async (url: string) => responseFor(url));
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('fetch', fetchSpy);
  return { fetchSpy, responseFor, getImageCreations: () => imageCreations };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Shared prepared anatomy cache', () => {
  it('deduplicates simultaneous and repeat opens without restarting image downloads', async () => {
    const { fetchSpy, getImageCreations } = setUpAssets();
    const { loadWorkedMuscleAtlas } = await import('./workedMuscleAtlas');
    const [first, second] = await Promise.all([
      loadWorkedMuscleAtlas('front'), loadWorkedMuscleAtlas('front'),
    ]);
    expect(first).toBe(second);
    expect(await loadWorkedMuscleAtlas('front')).toBe(first);
    expect(first.mask[80 * 1024 + 50]).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(getImageCreations()).toBe(3);
  });

  it('evicts a failed load so a subsequent component open can retry', async () => {
    const { fetchSpy, responseFor } = setUpAssets();
    let failFirst = true;
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes('manifest.json') && failFirst) {
        failFirst = false;
        throw new Error('Offline');
      }
      return responseFor(url);
    });
    const { loadWorkedMuscleAtlas } = await import('./workedMuscleAtlas');
    await expect(loadWorkedMuscleAtlas('front')).rejects.toThrow('Offline');
    await expect(loadWorkedMuscleAtlas('front')).resolves.toHaveProperty('width', 1024);
  });
});
