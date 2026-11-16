// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscussionSwipeReplyIndicator, DiscussionSwipeReplyRow } from './DiscussionSwipeReplyRow';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(enabled = true) {
  const onReply = vi.fn();
  const view = render(<DiscussionSwipeReplyRow messageId="incoming" own={false}
    highlighted={false} enabled={enabled} onReply={onReply} rowRef={() => {}}>
    <div className="bubble"><span>Текст сообщения</span><DiscussionSwipeReplyIndicator /></div>
  </DiscussionSwipeReplyRow>);
  const row = view.container.querySelector<HTMLElement>('[data-message-id="incoming"]');
  const cue = view.container.querySelector<HTMLElement>('.discussion-reply-swipe-indicator');
  if (!row || !cue) throw new Error('Missing reply swipe surface');
  function down(x: number) {
    fireEvent.pointerDown(row, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  function move(x: number) {
    fireEvent.pointerMove(row, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  function end(x: number) {
    fireEvent.pointerUp(row, { pointerId: 11, pointerType: 'mouse', button: 0,
      isPrimary: true, clientX: x, clientY: 25 });
  }
  return { ...view, row, cue, onReply, down, move, end };
}

describe('reply swipe affordance from the supplied gesture reference', () => {
  it('starts hidden, grows with the displacement and arms at the same 50px threshold', () => {
    const gesture = mount();
    expect(gesture.cue.getAttribute('aria-hidden')).toBe('true');
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.cue.querySelector('.discussion-reply-swipe-indicator__icon')).not.toBeNull();
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();

    gesture.down(200);
    gesture.move(175);
    expect(gesture.row.style.transform).toBe('translate3d(-25px, 0, 0)');
    expect(gesture.cue.style.transform).toContain('translate3d(25px, -50%, 0)');
    expect(Number(gesture.cue.style.opacity)).toBeGreaterThan(0);
    expect(Number(gesture.cue.style.opacity)).toBeLessThan(1);
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();

    gesture.move(150);
    expect(gesture.cue.style.opacity).toBe('1');
    expect(gesture.cue.style.transform).toContain('translate3d(50px, -50%, 0) scale(1)');
    expect(gesture.cue.getAttribute('data-armed')).toBe('true');
    expect(gesture.onReply).not.toHaveBeenCalled();

    gesture.move(60);
    expect(gesture.row.style.transform).toBe('translate3d(-100px, 0, 0)');
    expect(gesture.cue.style.transform).toContain('translate3d(100px, -50%, 0) scale(1)');
    gesture.end(60);
    expect(gesture.onReply).toHaveBeenCalledOnce();
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
  });

  it('unarms and disappears if the finger moves back before release', () => {
    const gesture = mount();
    gesture.down(200);
    gesture.move(132);
    expect(gesture.cue.getAttribute('data-armed')).toBe('true');
    gesture.move(180);
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    gesture.end(180);
    expect(gesture.onReply).not.toHaveBeenCalled();
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.row.style.transform).toBe('');
  });

  it('does not show the arrow for a disabled or deleted message', () => {
    const gesture = mount(false);
    gesture.down(200);
    gesture.move(100);
    gesture.end(100);
    expect(gesture.cue.style.opacity).toBe('0');
    expect(gesture.cue.getAttribute('data-armed')).toBeNull();
    expect(gesture.onReply).not.toHaveBeenCalled();
  });
});
