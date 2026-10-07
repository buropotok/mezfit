/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPressScale } from './PressScale';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startPressScale', () => {
  it('keeps the shared default press scale and timing', () => {
    const element = document.createElement('button');
    const animate = vi.spyOn(element, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);

    startPressScale(element);

    expect(animate).toHaveBeenCalledWith(
      [
        { scale: '1', easing: 'ease-out' },
        { scale: '0.93', offset: 120 / 530, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
        { scale: '1' },
      ],
      { duration: 530 },
    );
  });

  it('supports the FAB 1.5x peak without changing the timing', () => {
    const element = document.createElement('button');
    const animate = vi.spyOn(element, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);

    startPressScale(element, 1.5);

    expect(animate).toHaveBeenCalledWith(
      [
        { scale: '1', easing: 'ease-out' },
        { scale: '1.5', offset: 120 / 530, easing: 'cubic-bezier(.2, 1.30, .3, 1)' },
        { scale: '1' },
      ],
      { duration: 530 },
    );
  });
});
