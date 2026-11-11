import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { requestTelegramVideoFullscreen } from '../telegram';

export function DiscussionMediaStage({ label, className = '', style, fullscreen, children }: {
  label: string;
  className?: string;
  style?: CSSProperties;
  fullscreen?: boolean;
  children: ReactNode;
}) {
  const inline = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement('div'));
  const [attached, setAttached] = useState(false);

  // Keep the same video element when the stage moves out of the sheet.
  useLayoutEffect(() => {
    const target = fullscreen ? document.body : inline.current;
    host.className = fullscreen ? 'navigation-overlay-root k-ios dark safe-areas' : '';
    if (!target) return;
    target.appendChild(host);
    // Mount child portals after the host, so the timer menu backdrop stacks above it.
    setAttached(true);
  }, [fullscreen, host]);
  useLayoutEffect(() => () => { host.remove(); }, [host]);

  useEffect(() => {
    if (fullscreen) return requestTelegramVideoFullscreen();
  }, [fullscreen]);

  return <>
    <div ref={inline} className="discussion-media-stage__anchor" />
    {attached && createPortal(
      <section className={`discussion-media-stage ${className}${fullscreen ? ' discussion-media-stage--fullscreen' : ''}`}
        role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={label}
        style={fullscreen ? undefined : style}>
        {children}
      </section>,
      host,
    )}
  </>;
}
