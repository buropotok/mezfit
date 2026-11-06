import { useEffect, useState } from 'react';

/** Geometry only: no Telegram patches, focus stealing or body scroll locks. */
export function useDiscussionViewport(enabled: boolean) {
  const [geometry, setGeometry] = useState({ bottom: 0, maxHeight: '100dvh' });
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      setGeometry({ bottom: Math.max(0, window.innerHeight - height - top),
        maxHeight: `max(0px, calc(${height}px - var(--navigation-navbar-bottom, 3.75rem) - 36px))` });
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [enabled]);
  return geometry;
}
