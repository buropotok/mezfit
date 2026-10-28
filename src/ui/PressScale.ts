export const PRESS_SCALE_DURATION = 530;
export const PRESS_SCALE_PEAK_TIME = 120;

const pressScaleAnimations = new WeakMap<HTMLElement, Animation>();

export function startPressScale(element: HTMLElement, peakScale = 0.93) {
  pressScaleAnimations.get(element)?.cancel();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animation = element.animate(
    [
      { scale: '1', easing: 'ease-out' },
      { scale: String(peakScale), offset: PRESS_SCALE_PEAK_TIME / PRESS_SCALE_DURATION, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
      { scale: '1' },
    ],
    { duration: reduceMotion ? 1 : PRESS_SCALE_DURATION },
  );
  pressScaleAnimations.set(element, animation);
  return animation;
}

export function isPressScaleActivationKey(key: string) {
  return key === 'Enter' || key === ' ';
}
