import './press-scale.css';

const PRESS_SCALE_CLASS = 'ui-press-scale--running';

/**
 * Starts the complete press animation on pointer-down. The CSS animation owns
 * both the press and release phases, so a quick pointer-up cannot cancel it.
 */
export function startPressScale(element: HTMLElement) {
  element.classList.remove(PRESS_SCALE_CLASS);
  // Restart the animation for repeated taps, including taps before the previous
  // cycle has finished. The read is intentionally local to the pressed control.
  void element.offsetWidth;
  element.classList.add(PRESS_SCALE_CLASS);
}
