import { useEffect } from 'react';
import { loadWorkedMuscleAtlas } from './workedMuscleAtlas';

/**
 * Optional warm-up after the authenticated shell has mounted.
 * A shared atlas loader owns cache lifetime, not this invisible component.
 * Scheduling is cancelled on unmount; a started immutable image request may
 * finish and safely populate the shared media cache.
 */
export function WorkedMuscleAssetsPrefetch() {
  useEffect(() => {
    const prefetch = () => {
      void loadWorkedMuscleAtlas('front', 'female').catch(() => undefined);
      void loadWorkedMuscleAtlas('rear', 'female').catch(() => undefined);
    };
    if ('requestIdleCallback' in window && typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => { if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id); };
    }
    // iOS WKWebView builds without requestIdleCallback still warm after paint.
    const id = window.setTimeout(prefetch, 800);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
