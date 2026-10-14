import { describe, expect, it, vi } from 'vitest';
import { initialExerciseMediaUrls, warmExerciseMedia } from './PublicExerciseMediaPrefetch';
import type { PublicExerciseRow } from '../data/exercises/publicExerciseTypes';

const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const row = (id: number, category = 'chest'): PublicExerciseRow => ({
  id: String(id).padStart(4, '0'), category, sourceSha256: sha,
  gif_url: 'videos/exercise.gif',
} as PublicExerciseRow);

describe('background image cache warm-up', () => {
  it('selects just one GIF per category before opening the catalogue', () => {
    const records = Array.from({ length: 40 }, (_, i) => row(i + 1, i % 2 ? 'chest' : 'back'));
    const urls = initialExerciseMediaUrls(records);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/api/exercise-media/gym_keeper_apk/0001?v=');
    expect(urls[1]).toContain('/api/exercise-media/gym_keeper_apk/0002?v=');
  });

  it('ignores rows with wrong source revisions', () => {
    const rows = [{ ...row(1), sourceSha256: '0'.repeat(64) }, row(2)];
    expect(initialExerciseMediaUrls(rows)).toHaveLength(1);
  });

  it('warms versioned URLs with bounded concurrency and browser cache', async () => {
    let running = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      running++;
      peak = Math.max(peak, running);
      expect(init?.cache).toBe('force-cache');
      await Promise.resolve();
      running--;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await warmExerciseMedia(Array.from({ length: 20 }, (_, i) => `/media/${i}`), new AbortController().signal, fetchFn);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('does not start prefetch after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await warmExerciseMedia(['/media/1'], controller.signal, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
