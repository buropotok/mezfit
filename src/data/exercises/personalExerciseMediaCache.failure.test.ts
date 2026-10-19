import { describe, expect, it, vi } from 'vitest';

vi.mock('dexie', () => ({
  default: class {
    images = {
      get: async () => { throw new Error('IndexedDB unavailable'); },
      put: async () => { throw new Error('QuotaExceededError'); },
    };
    version() { return { stores: () => undefined }; }
    close() {}
  },
}));

import { loadPersonalExerciseMedia } from './personalExerciseMediaCache';

const url = '/api/exercise-media/personal/11111111-1111-4111-8111-111111111111?v=' + 'a'.repeat(64);

describe('R2 download survives unavailable local IndexedDB', () => {
  it('returns fetched image bytes even when opening IndexedDB fails', async () => {
    const fetchImage = vi.fn(async () => new Response(new Blob(['sample'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    const image = await loadPersonalExerciseMedia('tg:202', url, undefined, fetchImage);
    expect(image?.size).toBe(6);
    expect(image?.type).toBe('image/png');
    expect(fetchImage).toHaveBeenCalledOnce();
  });
});
