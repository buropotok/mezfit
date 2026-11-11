import { useEffect, useRef, type ReactNode } from 'react';
import './discussion-set-focus.css';

/** App-owned overlay around an unchanged ListItem. The effect runs only when
 * the target is visible, rather than during the containing sheet's entrance. */
export function DiscussionSetFocus({ ready, children }: { ready: boolean; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ready) row.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }, [ready]);
  return <div ref={row} role="presentation" className="discussion-set-focus">
    {children}
    {ready ? <span aria-hidden="true" className="discussion-set-focus__flash" /> : null}
  </div>;
}
