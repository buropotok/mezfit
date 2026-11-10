import { useEffect, useRef, useState } from 'react';
import { downloadDiscussionMedia, readDiscussionMedia, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';

export function useDiscussionMediaSource(
  src: string, cache: DiscussionMediaCacheEntry | undefined, mode: 'cache-only' | 'photo' | 'video', retry: number, lazy: boolean,
) {
  const { accountId, storageKey, mimeType, sizeBytes } = cache ?? {};
  const container = useRef<HTMLDivElement>(null);
  const identity = JSON.stringify([src, accountId, storageKey, mimeType, sizeBytes, mode, retry]);
  const [resolved, setResolved] = useState<{ identity: string; url: string }>();

  useEffect(() => {
    if (!accountId || !storageKey || !mimeType || sizeBytes === undefined) return;
    const entry = { accountId, storageKey, mimeType, sizeBytes };
    let active = true;
    let objectUrl: string | undefined;
    const load = async () => {
      const cached = await readDiscussionMedia(entry);
      if (!active) return;
      if (!cached && mode === 'video') void downloadDiscussionMedia(entry);
      const blob = cached ?? (mode === 'photo' ? await downloadDiscussionMedia(entry) : null);
      if (!active) return;
      if (blob && typeof URL.createObjectURL === 'function') objectUrl = URL.createObjectURL(blob);
      setResolved({ identity, url: objectUrl ?? src });
    };
    let observer: IntersectionObserver | undefined;
    if (lazy && container.current && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        if (!active || !entries.some(entry => entry.isIntersecting)) return;
        observer?.disconnect();
        void load();
      });
      observer.observe(container.current);
    } else void load();
    return () => {
      observer?.disconnect();
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, accountId, storageKey, mimeType, sizeBytes, mode, identity, lazy]);

  const url = !accountId ? src : resolved?.identity === identity ? resolved.url : undefined;
  return { url, container };
}
