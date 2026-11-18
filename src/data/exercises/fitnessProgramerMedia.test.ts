import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchFitnessProgramerMedia, FitnessProgramerMedia } from './fitnessProgramerMedia';

const id = 'fitnessprogramer:gif:' + 'b'.repeat(64);
const preview = new Blob(['RIFF0000WEBPVP8 '], { type: 'image/webp' });
const legacyGif = new Blob(['GIF89a'], { type: 'image/gif' });
const repo = {
  availableGifIds: async () => new Set([id]),
  readLocalGif: async () => legacyGif,
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Dexie.delete('mezfit-base2-public-media-v1');
});

it('requests the same immutable preview from R2 when Yandex returns invalid bytes', async () => {
  const fetchImage = vi.fn()
    .mockResolvedValueOnce(new Response(new Blob(['invalid webp payload'], { type: 'image/webp' })))
    .mockResolvedValueOnce(new Response(preview));
  vi.stubGlobal('fetch', fetchImage);
  const result = await fetchFitnessProgramerMedia({ id, format: 'webp' }, new AbortController().signal);
  expect(result?.size).toBe(preview.size);
  const file = 'b'.repeat(64) + '.webp';
  expect(fetchImage.mock.calls.map(([url]) => url)).toEqual([
    'https://storage.yandexcloud.net/mezfit-comm-poc-20261106/exercises/base2/v1/' + file,
    '/api/exercise-media/base2/v1/' + file,
  ]);
});

it('keeps cached GIFs immediately readable when all four background downloads are stalled', async () => {
  const fetchImage = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  vi.stubGlobal('fetch', fetchImage);
  const media = new FitnessProgramerMedia(repo);
  try {
    media.warm(['1', '2', '3', '4', '5'].map(char => 'fitnessprogramer:gif:' + char.repeat(64)));
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));
    const show = vi.fn();
    media.watch(id, show);
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith(legacyGif, 'gif'));
    expect(fetchImage).toHaveBeenCalledTimes(4);
  } finally {
    media.close();
  }
});
