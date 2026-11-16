// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscussionAvatarFlightLayer, DISCUSSION_AVATAR_FLIGHT_DURATION, canHandoffDiscussionAvatar,
  type PendingDiscussionAvatarFlight } from './DiscussionAvatarFlightLayer';
import { discussionAvatarFlightKey } from './DiscussionAvatarFlightContext';

const flight: PendingDiscussionAvatarFlight = {
  id: 7,
  key: discussionAvatarFlightKey('pair-1', 'exercise:1'),
  source: { left: 24, top: 510, width: 40, height: 40 },
  avatar: { name: 'Анна', src: 'blob:anna' },
  arrived: false,
};
const target = { left: 125, top: 188, width: 40, height: 40 };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared discussion avatar -> navbar', () => {
  it('never hands off until both flight and navbar have finished for the exact chat', () => {
    expect(DISCUSSION_AVATAR_FLIGHT_DURATION).toBeGreaterThan(340);
    expect(canHandoffDiscussionAvatar(flight, 2, 2, flight.key)).toBe(false);
    const landed = { ...flight, arrived: true };
    expect(canHandoffDiscussionAvatar(landed, 2, 1, flight.key)).toBe(false);
    expect(canHandoffDiscussionAvatar(landed, 2, null, flight.key)).toBe(false);
    expect(canHandoffDiscussionAvatar(landed, 2, 2, discussionAvatarFlightKey('pair-2', 'exercise:1'))).toBe(false);
    expect(canHandoffDiscussionAvatar(landed, 1, 2, flight.key)).toBe(false);
    expect(canHandoffDiscussionAvatar(landed, 2, 2, flight.key)).toBe(true);
  });

  it('moves in a straight line with scale, retaining the source until destination measurement', () => {
    let advance: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { advance = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const arrived = vi.fn();
    const view = render(<DiscussionAvatarFlightLayer flight={flight} target={null} onArrived={arrived} />);
    const movingAvatar = view.container.firstElementChild as HTMLElement;
    expect(movingAvatar.style.left).toBe('24px');
    expect(movingAvatar.style.top).toBe('510px');
    expect(movingAvatar.style.transform).toContain('translate3d(0, 0, 0)');
    expect(arrived).not.toHaveBeenCalled();

    view.rerender(<DiscussionAvatarFlightLayer flight={flight} target={target} onArrived={arrived} />);
    act(() => { advance?.(0); });
    expect(movingAvatar.style.transform).toBe('translate3d(101px, -322px, 0) scale(1)');
    fireEvent.transitionEnd(movingAvatar, { propertyName: 'transform' });
    expect(arrived).toHaveBeenCalledWith(7);
  });

  it('honors reduced motion without waiting for transitionend', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const arrived = vi.fn();
    render(<DiscussionAvatarFlightLayer flight={flight} target={target} onArrived={arrived} />);
    expect(arrived).toHaveBeenCalledWith(7);
  });
});
