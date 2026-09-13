const pressScaleAnimations = new WeakMap<HTMLElement, Animation>();

export function startPressScale(element: HTMLElement) {
  pressScaleAnimations.get(element)?.cancel();
  const animation = element.animate(
    [
      { scale: '1', easing: 'ease-out' },
      { scale: '.93', offset: 120 / 530, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
      { scale: '1' },
    ],
    { duration: 530 },
  );
  pressScaleAnimations.set(element, animation);
}
