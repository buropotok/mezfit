import { useEffect, useMemo } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PublicExerciseCatalogueRepository } from '../data/exercises/publicExerciseCatalogue';
import type { PublicExerciseRow } from '../data/exercises/publicExerciseTypes';
import { publicExerciseMediaUrl } from './PublicExerciseMedia';

/**
 * Warm the browser's HTTP image cache after login, before any catalogue page
 * mounts. Intentionally bounded to one GIF per category: preloading 1324 GIFs would waste bandwidth
 * and freeze mobile WebViews. Cache-Control on the versioned Worker URL is
 * authoritative; no parallel IndexedDB media store is introduced.
 */
export function initialExerciseMediaUrls(rows: PublicExerciseRow[], perCategory = 1): string[] {
  const counts = new Map<string, number>();
  const urls: string[] = [];
  for (const row of rows) {
    const used = counts.get(row.category) ?? 0;
    if (used >= perCategory) continue;
    const url = publicExerciseMediaUrl(row);
    if (!url) continue;
    urls.push(url);
    counts.set(row.category, used + 1);
  }
  return urls.slice(0, 9);
}

export async function warmExerciseMedia(urls: string[], signal: AbortSignal, fetchFn: typeof fetch = fetch): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, urls.length) }, async () => {
    while (!signal.aborted && cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const response = await fetchFn(url, { method: 'GET', cache: 'force-cache', signal });
        if (response.ok) await response.arrayBuffer(); // Drain the body so HTTP cache can commit it.
      } catch {
        // Optional media failures must not affect authentication or app startup.
      }
    }
  }));
}

/** Invisible bootstrap owned by the authenticated Cloud provider. */
export function PublicExerciseMediaPrefetch() {
  const cloud = useCloudConnections();
  const db = cloud?.db;
  const repository = useMemo(() => db ? new PublicExerciseCatalogueRepository(db) : null, [db]);

  useEffect(() => {
    if (!repository) return undefined;
    const controller = new AbortController();
    let started = false;
    const subscription = repository.observe((snapshot) => {
      if (started || snapshot.status !== 'ready' || controller.signal.aborted) return;
      started = true;
      void warmExerciseMedia(initialExerciseMediaUrls(snapshot.exercises), controller.signal);
    }, () => undefined);
    return () => { controller.abort(); subscription.unsubscribe(); };
  }, [repository]);

  return null;
}
