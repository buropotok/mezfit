import { useEffect, useRef, useState } from 'react';

type Ripple = {
  id: number;
  x: number;
  y: number;
  size: number;
};

const ANIMATION_DURATION_MS = 700;

export function RippleEffect() {
  const containerRef = useRef<HTMLSpanElement>(null);
  const nextIdRef = useRef(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (!parent) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const position = parent.getBoundingClientRect();
      const size = parent.offsetWidth / 2;
      const id = nextIdRef.current++;

      setRipples((current) => [
        ...current,
        {
          id,
          x: event.clientX - position.x - size / 2,
          y: event.clientY - position.y - size / 2,
          size,
        },
      ]);
    };

    parent.addEventListener('pointerdown', handlePointerDown);
    return () => parent.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (ripples.length === 0) return undefined;

    const timeout = window.setTimeout(() => {
      setRipples([]);
    }, ANIMATION_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [ripples]);

  return (
    <span ref={containerRef} className="ui-ripple" aria-hidden="true">
      {ripples.map(({ id, x, y, size }) => (
        <span
          key={id}
          className="ui-ripple__wave"
          style={{ left: x, top: y, width: size, height: size }}
        />
      ))}
    </span>
  );
}
