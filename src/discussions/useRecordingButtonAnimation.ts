import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { PRESS_SCALE_DURATION, PRESS_SCALE_PEAK_TIME } from '../ui/PressScale';
import type { RecordingGesturePhase } from './useRecordingGesture';

/** Animate only the chat-owned material, preserving the button's fixed centre. */
export function useRecordingButtonAnimation(surface: RefObject<HTMLElement | null>, phase: RecordingGesturePhase) {
  const animation = useRef<Animation | undefined>(undefined);
  const previous = useRef<RecordingGesturePhase>('idle');
  const stage = phase === 'locked' ? 'holding' : phase;
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element || typeof element.animate !== 'function') return;
    const current = getComputedStyle(element).scale;
    const scale = current && current !== 'none' ? current : '1';
    const elapsed = typeof animation.current?.currentTime === 'number' ? animation.current.currentTime : 0;
    if (animation.current) { animation.current.onfinish = null; animation.current.cancel(); }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (stage === 'pressing') {
      // Hold at the peak until the gesture decides whether to continue growing.
      animation.current = element.animate([{ scale }, { scale: '1.5' }],
        { duration: reduced ? 1 : PRESS_SCALE_PEAK_TIME, easing: 'ease-out', fill: 'forwards' });
    } else if (stage === 'holding') {
      const grow = element.animate([{ scale }, { scale: '2' }],
        { duration: reduced ? 1 : 200, easing: 'ease-in-out', fill: 'forwards' });
      animation.current = grow;
      if (!reduced) grow.onfinish = () => {
        const breath = element.animate([{ scale: '2' }, { scale: '1.85' }],
          { duration: 1100, easing: 'ease-in-out', iterations: Infinity, direction: 'alternate' });
        grow.cancel();
        animation.current = breath;
      };
    } else if (previous.current === 'pressing') {
      // A quick tap still completes the press peak and the normal spring return.
      const remaining = Math.max(0, PRESS_SCALE_PEAK_TIME - elapsed);
      const duration = remaining + PRESS_SCALE_DURATION - PRESS_SCALE_PEAK_TIME;
      animation.current = element.animate([
        { scale, easing: 'ease-out' },
        { scale: '1.5', offset: remaining / duration, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
        { scale: '1' },
      ], { duration: reduced ? 1 : duration });
    } else if (previous.current === 'holding') {
      animation.current = element.animate([{ scale }, { scale: '1' }],
        { duration: reduced ? 1 : 200, easing: 'ease-out' });
    }
    previous.current = stage;
  }, [stage, surface]);
  useEffect(() => () => {
    if (animation.current) { animation.current.onfinish = null; animation.current.cancel(); }
  }, []);
}
