const springScaleAnimations = new WeakMap<HTMLElement, Animation>();

export function startSpringScale(element: HTMLElement) {
  springScaleAnimations.get(element)?.cancel();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animation = element.animate(
    [
      { transform: 'scale(1)', offset: 0 },
      { transform: 'scale(1.28)', offset: .20, easing: 'cubic-bezier(.18,.89,.32,1.28)' },
      { transform: 'scale(.92)', offset: .42, easing: 'ease-out' },
      { transform: 'scale(1.09)', offset: .62, easing: 'ease-out' },
      { transform: 'scale(.98)', offset: .78, easing: 'ease-out' },
      { transform: 'scale(1.025)', offset: .90, easing: 'ease-out' },
      { transform: 'scale(1)', offset: 1 },
    ],
    { duration: reduceMotion ? 1 : 560, easing: 'linear' },
  );
  springScaleAnimations.set(element, animation);
}
