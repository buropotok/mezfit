const PRESS_SCALE_CLASS = 'ui-press-scale--running';

/** Starts a complete press/release cycle that survives a quick pointer-up. */
export function startPressScale(element: HTMLElement) {
  element.classList.remove(PRESS_SCALE_CLASS);
  void element.offsetWidth;
  element.classList.add(PRESS_SCALE_CLASS);
}
