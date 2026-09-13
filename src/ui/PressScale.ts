const pressScaleAnimations = new WeakMap<HTMLElement, Animation>();

export function startPressScale(element: HTMLElement) {
  pressScaleAnimations.get(element)?.cancel();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animation = element.animate(
    [
      { scale: '1', easing: 'ease-out' },
      { scale: '.93', offset: 120 / 530, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
      { scale: '1' },
    ],
    { duration: reduceMotion ? 1 : 530 },
  );
  pressScaleAnimations.set(element, animation);
}

export function isPressScaleActivationKey(key: string) {
  return key === 'Enter' || key === ' ';
}
