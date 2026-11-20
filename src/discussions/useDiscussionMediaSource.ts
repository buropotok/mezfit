import { useEffect, useRef, useState } from 'react';
import { downloadDiscussionMedia, downloadDiscussionMediaWithStatus, readDiscussionMedia, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { signedDiscussionR2ReadUrl } from '../media/cloudflareMediaRead';
import { DISCUSSION_MEDIA_KEY_PATTERN } from '../../shared/discussion-media-limits';

export function useDiscussionMediaSource(
  src: string, cache: DiscussionMediaCacheEntry | undefined, mode: 'cache-only' | 'photo' | 'video', retry: number, lazy: boolean,
) {
  const { accountId, storageKey, mimeType, sizeBytes, realmId, messageId, attachmentId } = cache ?? {};
  const fullPhoto = mode === 'photo' && Boolean(storageKey && DISCUSSION_MEDIA_KEY_PATTERN.exec(storageKey)?.[2] === 'full');
  const container = useRef<HTMLDivElement>(null);
  const identity = JSON.stringify([src, accountId, storageKey, mimeType, sizeBytes, realmId, messageId, attachmentId, mode, retry]);
  const [resolved, setResolved] = useState<{ identity: string; url: string | null; r2Failure?: string }>();
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const fallbackSelected = useRef<string | null>(null);
  const fallbackInFlight = useRef<{ identity: string; promise: Promise<boolean> } | null>(null);

  /** Called after the browser media element fails; no R2 GET is issued merely
   * because a message appeared in the viewport.
   */
  const tryR2Fallback = (): Promise<boolean> => {
    if (!cache?.realmId || !cache.messageId || !cache.attachmentId || !src.startsWith('https:')
      || resolved?.identity === identity && resolved.url?.startsWith('blob:')
      || fallbackSelected.current === identity) return Promise.resolve(false);
    if (fallbackInFlight.current?.identity === identity) return fallbackInFlight.current.promise;
    const promise = signedDiscussionR2ReadUrl(cache).then(url => {
      if (!mounted.current || latestIdentity.current !== identity) return false;
      fallbackSelected.current = identity;
      setResolved({ identity, url });
      return true;
    }).catch(() => false).finally(() => {
      if (fallbackInFlight.current?.identity === identity) fallbackInFlight.current = null;
    });
    fallbackInFlight.current = { identity, promise };
    return promise;
  };

  useEffect(() => {
    if (!accountId || !storageKey || !mimeType || sizeBytes === undefined) return;
    const entry = { accountId, storageKey, mimeType, sizeBytes, realmId, messageId, attachmentId };
    let active = true;
    let objectUrl: string | undefined;
    const load = async () => {
      const cached = await readDiscussionMedia(entry);
      if (!active) return;
      if (!cached && mode === 'video') void downloadDiscussionMedia(entry);
      const download = !cached && fullPhoto ? await downloadDiscussionMediaWithStatus(entry) : null;
      const blob = cached ?? (download ? download.blob : mode === 'photo' ? await downloadDiscussionMedia(entry) : null);
      if (!active) return;
      if (blob && typeof URL.createObjectURL === 'function') objectUrl = URL.createObjectURL(blob);
      // A late Yandex cache lookup must not overwrite an already-selected R2 URL.
      if (fallbackSelected.current !== identity) {
        setResolved({ identity, url: objectUrl ?? (fullPhoto && !blob ? null : src), r2Failure: download?.r2Failure });
      }
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
  }, [src, accountId, storageKey, mimeType, sizeBytes, realmId, messageId, attachmentId, mode, identity, lazy, fullPhoto]);

  const current = resolved?.identity === identity ? resolved : undefined;
  const url = !accountId ? src : current?.url;
  return { url: url ?? undefined, unavailable: url === null, r2Failure: current?.r2Failure, container, tryR2Fallback };
}
