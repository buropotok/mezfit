import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import './press-spot.css';

type PressSpotState = {
  id: number;
  x: number;
  y: number;
};

export function usePressSpot<T extends HTMLElement>(disabled = false) {
  const [spot, setSpot] = useState<PressSpotState | null>(null);
  const nextIdRef = useRef(0);

  const startPressSpot = (event: PointerEvent<T>) => {
    if (disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    nextIdRef.current += 1;
    setSpot({
      id: nextIdRef.current,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const pressSpot = spot ? (
    <span
      key={spot.id}
      className="ui-press-spot"
      style={{ '--ui-press-x': `${spot.x}px`, '--ui-press-y': `${spot.y}px` } as CSSProperties}
      onAnimationEnd={() => setSpot(null)}
      aria-hidden="true"
    />
  ) : null;

  return { pressSpot, startPressSpot };
}
