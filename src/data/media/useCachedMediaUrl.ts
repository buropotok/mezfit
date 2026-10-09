import { useEffect, useState } from 'react';
import { publicMediaCache, type MediaCache } from './MediaCache';

export function useCachedMediaUrl(
  url: string | null,
  mediaCache: MediaCache = publicMediaCache,
): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setResolvedUrl(null);
      return undefined;
    }

    setResolvedUrl(null);
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;

    mediaCache.resolve(url, controller.signal)
      .then((resolved) => {
        if (!active) {
          if (resolved.revoke) URL.revokeObjectURL(resolved.src);
          return;
        }
        objectUrl = resolved.revoke ? resolved.src : null;
        setResolvedUrl(resolved.src);
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setResolvedUrl(url);
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaCache, url]);

  return resolvedUrl;
}
