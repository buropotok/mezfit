import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';

gsap.registerPlugin(MorphSVGPlugin);

export type DiscussionActionMode = 'microphone' | 'camera' | 'send';

// Each state uses one filled path in the same 24x24 coordinate system.
// The send silhouette has a short open notch between its wings.
const actionPaths: Record<DiscussionActionMode, string> = {
  microphone: 'M19 9a1 1 0 0 1 1 1a8 8 0 0 1 -6.999 7.938l-.001 2.062h3a1 1 0 0 1 0 2h-8a1 1 0 0 1 0 -2h3v-2.062a8 8 0 0 1 -7 -7.938a1 1 0 1 1 2 0a6 6 0 0 0 12 0a1 1 0 0 1 1 -1m-7 -8a4 4 0 0 1 4 4v5a4 4 0 1 1 -8 0v-5a4 4 0 0 1 4 -4',
  camera: 'M15 3a2 2 0 0 1 1.995 1.85l.005 .15a1 1 0 0 0 .883 .993l.117 .007h1a3 3 0 0 1 2.995 2.824l.005 .176v9a3 3 0 0 1 -2.824 2.995l-.176 .005h-14a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-9a3 3 0 0 1 2.824 -2.995l.176 -.005h1a1 1 0 0 0 1 -1a2 2 0 0 1 1.85 -1.995l.15 -.005h6zm-3 7a3 3 0 0 0 -2.985 2.698l-.011 .152l-.004 .15l.004 .15a3 3 0 1 0 2.996 -3.15z',
  send: 'M21.65 2.2 L15.41 21.417 C15.143 22.018 14.63 22.32 14 22.32 C13.388 22.32 12.898 22 12.606 21.446 L9.726 15.687 L15.50 9.45 C15.95 8.97 15.74 8.47 15.31 8.31 C14.91 8.16 14.68 8.39 14.35 8.72 L8.311 14.273 L2.583 11.409 C2.012 11.12 1.68 10.644 1.68 10 C1.68 9.394 2.033 8.844 2.661 8.56 Z',
};

export function DiscussionActionIcon({ mode }: { mode: DiscussionActionMode }) {
  const pathRef = useRef<SVGPathElement>(null);
  const previousMode = useRef(mode);
  // React must not replace d on subsequent renders; MorphSVG owns the path geometry.
  const initialPath = useRef(actionPaths[mode]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || previousMode.current === mode) return;
    previousMode.current = mode;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      gsap.killTweensOf(path);
      path.setAttribute('d', actionPaths[mode]);
      return;
    }
    gsap.to(path, { morphSVG: actionPaths[mode], duration: 0.28, ease: 'power2.inOut', overwrite: 'auto' });
    return () => gsap.killTweensOf(path);
  }, [mode]);

  return <svg width="24" height="24" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" focusable="false">
    <path ref={pathRef} d={initialPath.current} />
  </svg>;
}
