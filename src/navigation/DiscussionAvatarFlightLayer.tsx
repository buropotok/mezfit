import { useEffect, useState, type TransitionEvent } from 'react';
import { Avatar } from '../ui/primitives';
import type { AvatarFlightOrigin, AvatarFlightRect } from './DiscussionAvatarFlightContext';
import './discussion-avatar-flight.css';

export const DISCUSSION_AVATAR_FLIGHT_DURATION = 600;

export type PendingDiscussionAvatarFlight = AvatarFlightOrigin & { id: number; arrived: boolean };

export function canHandoffDiscussionAvatar(
  flight: PendingDiscussionAvatarFlight | null,
  level: 1 | 2,
  settledLevel: 1 | 2 | null,
  activeKey: string | undefined,
): boolean {
  return Boolean(flight?.arrived && level === 2 && settledLevel === 2 && activeKey === flight.key);
}

/** A temporary UI Kit Avatar, rendered outside all clipped discussion surfaces. */
export function DiscussionAvatarFlightLayer({ flight, target, onArrived }: {
  flight: PendingDiscussionAvatarFlight;
  target: AvatarFlightRect | null;
  onArrived: (id: number) => void;
}) {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!target) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onArrived(flight.id);
      return undefined;
    }
    const hasFrame = typeof window.requestAnimationFrame === 'function';
    const frame = hasFrame
      ? window.requestAnimationFrame(() => setMoving(true))
      : window.setTimeout(() => setMoving(true), 16);
    return () => {
      if (hasFrame) window.cancelAnimationFrame(frame);
      else window.clearTimeout(frame);
    };
  }, [target, flight.id, onArrived]);
  useEffect(() => {
    if (!moving || !target) return undefined;
    // Telegram WebView occasionally drops transitionend after lifecycle interruptions.
    const timer = window.setTimeout(() => onArrived(flight.id), DISCUSSION_AVATAR_FLIGHT_DURATION + 100);
    return () => window.clearTimeout(timer);
  }, [moving, target, flight.id, onArrived]);

  const source = flight.source;
  const scale = target ? Math.min(target.width / source.width, target.height / source.height) : 1;
  const dx = target ? target.left + target.width / 2 - source.left - source.width / 2 : 0;
  const dy = target ? target.top + target.height / 2 - source.top - source.height / 2 : 0;

  const transform = moving && target
    ? `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`
    : 'translate3d(0, 0, 0) scale(1)';
  const handleEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'transform') onArrived(flight.id);
  };
  return <div className="navigation-avatar-flight k-ios dark" aria-hidden="true" onTransitionEnd={handleEnd}
    style={{ left: source.left, top: source.top, width: source.width, height: source.height, transform }}>
    <Avatar name={flight.avatar.name} src={flight.avatar.src} />
  </div>;
}
