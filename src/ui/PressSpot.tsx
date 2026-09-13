import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

const PRESS_SPOT_DURATION_MS = 720;

type PressSpotState = {
  id: number;
  x: number;
  y: number;
};

export function usePressSpot<T extends HTMLElement>(disabled = false) {
  const [spot, setSpot] = useState<PressSpotState | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  const startPressSpot = (event: PointerEvent<T>) => {
    if (disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    nextIdRef.current += 1;
    setSpot({
      id: nextIdRef.current,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setSpot(null);
      timeoutRef.current = null;
    }, PRESS_SPOT_DURATION_MS);
  };

  const pressSpot = spot ? (
    <span
      key={spot.id}
      className="ui-press-spot"
      style={{ '--ui-press-x': `${spot.x}px`, '--ui-press-y': `${spot.y}px` } as CSSProperties}
      aria-hidden="true"
    />
  ) : null;

  return { pressSpot, startPressSpot };
}
