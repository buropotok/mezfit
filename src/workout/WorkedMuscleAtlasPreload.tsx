import { useEffect } from 'react';
import { preloadWorkedMuscleAtlases } from './workedMuscleAtlas';

/**
 * Authenticated-shell-owned, optional idle prefetch.
 * StrictMode/unmount cancels a scheduled warm-up; in-flight shared assets may
 * finish and are reused by the viewer instead of triggering duplicate loads.
 */
export function WorkedMuscleAtlasPreload() {
  useEffect(() => {
    const begin = () => { void preloadWorkedMuscleAtlases(); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(begin, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timeout = window.setTimeout(begin, 1200);
    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
