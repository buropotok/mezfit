// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscussionSwipeReplyIndicator, DiscussionSwipeReplyRow } from './DiscussionSwipeReplyRow';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(enabled = true) {
  const onReply = vi.fn();
  const view = render(<DiscussionSwipeReplyRow messageId="incoming" own={false}
    highlighted={false} enabled={enabled} onReply={onReply} rowRef={() => {}}>
    <div className="bubble"><span>Текст сообщения</span><DiscussionSwipeReplyIndicator /></div>
  </DiscussionSwipeReplyRow>);
  const row = view.container.querySelector<HTMLElement>('[data-message-id="incoming"]');
  const cue = view.container.querySelector<HTMLElement>('.discussion-reply-swipe-indicator');
  if (!row || !cue) throw new Error('Missing reply swipe surface');
  // A stable non-null alias is required for the nested gesture callbacks.
  const target: HTMLElement = row;
  function down(x: number) {
    fireEvent.pointerDown(target, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  function move(x: number) {
    fireEvent.pointerMove(target, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  function end(x: number) {
    fireEvent.pointerUp(target, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  return { ...view, row: target, cue, onReply, down, move, end };
}

describe('reply cue follows the user-approved 60/100px swipe geometry', () => {
  it('fills at 60px, runs one 50ms ring pulse before release, and returns with the bubble', () => {
    vi.useFakeTimers();
    const gesture = mount();
    const ring = gesture.cue.querySelector<SVGCircleElement>('.discussion-reply-swipe-indicator__fill');
    if (!ring) throw new Error('Missing circular reply progress');
    const circumference = Number(ring.getAttribute('stroke-dasharray'));
    expect(circumference).toBeGreaterThan(90);
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference);
    expect(gesture.cue.getAttribute('aria-hidden')).toBe('true');
    expect(gesture.cue.style.width).toBe('0px');
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.cue.querySelector('.discussion-reply-swipe-indicator__icon')).not.toBeNull();

    gesture.down(200);
    gesture.move(170);
    expect(gesture.row.style.transform).toBe('translate3d(-30px, 0, 0)');
    expect(gesture.cue.style.width).toBe('30px');
    expect(Number(gesture.cue.style.opacity)).toBeGreaterThan(0);
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 2);
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();

    gesture.move(140);
    expect(gesture.row.style.transform).toBe('translate3d(-60px, 0, 0)');
    expect(gesture.cue.style.width).toBe('60px');
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    expect(gesture.cue.getAttribute('data-armed')).toBe('true');
    expect(gesture.cue.getAttribute('data-pulsing')).toBe('true');
    expect(gesture.onReply).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(49));
    expect(gesture.cue.getAttribute('data-pulsing')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();

    gesture.move(50);
    expect(gesture.row.style.transform).toBe('translate3d(-100px, 0, 0)');
    expect(gesture.cue.style.width).toBe('100px');
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();
    gesture.move(180);
    expect(gesture.cue.style.width).toBe('20px');
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * (2 / 3));
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    gesture.move(140);
    expect(gesture.cue.getAttribute('data-armed')).toBe('true');
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();

    gesture.end(140);
    expect(gesture.onReply).toHaveBeenCalledOnce();
    expect(gesture.row.style.transform).toBe('');
    expect(gesture.cue.style.width).toBe('0px');
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference);
  });

  it('returns the cue without replying when release is below 60px', () => {
    const gesture = mount();
    gesture.down(200);
    gesture.move(130);
    expect(gesture.cue.getAttribute('data-armed')).toBe('true');
    gesture.move(141);
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    gesture.end(141);
    expect(gesture.onReply).not.toHaveBeenCalled();
    expect(gesture.cue.style.width).toBe('0px');
    expect(gesture.row.style.transform).toBe('');
  });

  it('does not show the indicator on disabled or deleted messages', () => {
    const gesture = mount(false);
    gesture.down(200);
    gesture.move(100);
    gesture.end(100);
    expect(gesture.cue.style.width).toBe('0px');
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    expect(gesture.cue.getAttribute('data-pulsing')).toBeNull();
    expect(gesture.onReply).not.toHaveBeenCalled();
  });
});
